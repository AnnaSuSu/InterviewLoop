import { createHash, timingSafeEqual } from 'node:crypto'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { AppError, type TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'
import { PLANS, type SubscriptionRepository } from './subscriptions.ts'

const PlanSchema = z.object({
  key: z.string(),
  label: z.string(),
  price_cents: z.number(),
  days: z.number(),
})

const SubscriptionSchema = z.object({
  active: z.boolean(),
  expires_at: z.string().nullable(),
  plans: z.array(PlanSchema),
})

const GrantRequestSchema = z.object({ user_id: z.string(), plan: z.string() })
const GrantResponseSchema = z.object({ ok: z.literal(true), expires_at: z.string() })

/** 先哈希再比较:长度不等时 timingSafeEqual 会抛错,而长度本身也是信息。 */
function secretMatches(provided: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(provided), hash(expected))
}

export function registerCloudRoutes(app: OpenAPIHono, deps: { subscriptions: SubscriptionRepository; tokens: TokenService }): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/cloud/subscription',
      responses: { 200: { content: { 'application/json': { schema: SubscriptionSchema } }, description: '当前订阅状态与可选套餐' } },
    }),
    async (c) => {
      const context = await authenticatedContext(c, deps.tokens)
      return c.json(deps.subscriptions.status(context.userId!))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/cloud/subscription/grant',
      request: { body: { content: { 'application/json': { schema: GrantRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: GrantResponseSchema } }, description: '发放订阅' } },
    }),
    async (c) => {
      // 支付渠道在别处对接,这里只把"收到钱了"翻译成有效期。没配 secret 就整个
      // 关闭,避免默认部署敞着一个能白送订阅的入口。
      const secret = process.env.CLOUD_GRANT_SECRET || ''
      if (!secret) throw new AppError('not enabled', 404)
      if (!secretMatches(c.req.header('x-cloud-secret') || '', secret)) throw new AppError('bad secret', 403)

      const body = c.req.valid('json')
      const userId = body.user_id.trim()
      if (!userId || !PLANS.some((plan) => plan.key === body.plan.trim())) {
        throw new AppError('user_id and a valid plan are required', 400)
      }
      const expiry = deps.subscriptions.grant(userId, body.plan.trim())
      console.log(JSON.stringify({ event: 'cloud:subscription_granted', userId, plan: body.plan.trim(), expiresAt: expiry.toISOString() }))
      return c.json({ ok: true as const, expires_at: expiry.toISOString() })
    },
  )
}
