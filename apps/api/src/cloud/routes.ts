import { createHash, timingSafeEqual } from 'node:crypto'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { AppError, type TokenService, type UsageRepository } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'
import { verifyOrderSignature, type AfdianOrder } from './afdian.ts'
import type { OrderRepository } from './orders.ts'
import { grantWithCarryOver } from './grant.ts'
import { processOrder, type OrderDependencies } from './process-order.ts'
import type { SubscriptionRepository } from './subscriptions.ts'
import { tierByKey, tiers } from './tiers.ts'

const TierSchema = z.object({
  key: z.string(),
  planId: z.string(),
  label: z.string(),
  price_cents: z.number(),
  token_quota: z.number(),
})

const SubscriptionSchema = z.object({
  active: z.boolean(),
  expires_at: z.string().nullable(),
  tier: z.string().nullable(),
  plans: z.array(TierSchema),
})

const GrantRequestSchema = z.object({ user_id: z.string(), plan: z.string(), months: z.number().optional() })
const GrantResponseSchema = z.object({ ok: z.literal(true), expires_at: z.string() })
const WebhookResponseSchema = z.object({ ec: z.number(), em: z.string() })

/** 先哈希再比较:长度不等时 timingSafeEqual 会抛错,而长度本身也是信息。 */
function secretMatches(provided: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(provided), hash(expected))
}

function requireSecret(provided: string): void {
  // 没配 secret 就整个关闭,避免默认部署敞着一个能白送订阅的入口
  const secret = process.env.CLOUD_GRANT_SECRET || ''
  if (!secret) throw new AppError('not enabled', 404)
  if (!secretMatches(provided, secret)) throw new AppError('bad secret', 403)
}

export function registerCloudRoutes(
  app: OpenAPIHono,
  deps: { subscriptions: SubscriptionRepository; orders: OrderRepository; usage: UsageRepository; tokens: TokenService; userExists: OrderDependencies['userExists'] },
): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/cloud/subscription',
      responses: { 200: { content: { 'application/json': { schema: SubscriptionSchema } }, description: '当前订阅状态与可选档位' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      return c.json(deps.subscriptions.status(context.userId!))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/cloud/afdian/webhook',
      request: { body: { content: { 'application/json': { schema: z.object({}).passthrough() } } } },
      responses: { 200: { content: { 'application/json': { schema: WebhookResponseSchema } }, description: '爱发电订单回调' } },
    }),
    async (c) => {
      const payload = (await c.req.json()) as { data?: { type?: string; order?: AfdianOrder; sign?: string } }
      const order = payload.data?.order

      // 平台只看 ec 是否为 200:返回非 200 它会重投,正好用来兜住我方的临时故障。
      if (payload.data?.type !== 'order' || !order?.out_trade_no) {
        return c.json({ ec: 400, em: 'not an order payload' })
      }
      if (!verifyOrderSignature(order, payload.data.sign)) {
        console.warn(JSON.stringify({ event: 'cloud:afdian_bad_signature', outTradeNo: order.out_trade_no }))
        return c.json({ ec: 403, em: 'invalid signature' })
      }

      const outcome = await processOrder(order, { orders: deps.orders, subscriptions: deps.subscriptions, usage: deps.usage, userExists: deps.userExists })
      console.log(JSON.stringify({ event: 'cloud:afdian_order', outTradeNo: order.out_trade_no, planId: order.plan_id, outcome }))
      // 已落库的一律回 200 让平台收手;真正需要重投的只有上面那些没走到这步的情况
      return c.json({ ec: 200, em: '' })
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/cloud/subscription/grant',
      request: { body: { content: { 'application/json': { schema: GrantRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: GrantResponseSchema } }, description: '手动发放订阅' } },
    }),
    async (c) => {
      // 人工兜底:对不上账号的订单、或收款渠道之外的发放走这里
      requireSecret(c.req.header('x-cloud-secret') || '')
      const body = c.req.valid('json')
      const userId = body.user_id.trim()
      if (!userId || !tierByKey(body.plan.trim())) {
        throw new AppError(`user_id and a valid plan are required (${tiers().map((t) => t.key).join(', ')})`, 400)
      }
      const expiry = await grantWithCarryOver(userId, body.plan.trim(), body.months ?? 1, { subscriptions: deps.subscriptions, usage: deps.usage })
      console.log(JSON.stringify({ event: 'cloud:subscription_granted', userId, tier: body.plan.trim(), expiresAt: expiry.toISOString() }))
      return c.json({ ok: true as const, expires_at: expiry.toISOString() })
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/cloud/orders/pending',
      responses: { 200: { content: { 'application/json': { schema: z.object({ list: z.array(z.record(z.string(), z.unknown())) }) } }, description: '待人工处理的订单' } },
    }),
    async (c) => {
      requireSecret(c.req.header('x-cloud-secret') || '')
      return c.json({ list: deps.orders.pending() })
    },
  )
}
