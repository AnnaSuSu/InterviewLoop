import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenAPIHono } from '@hono/zod-openapi'
import { AppError, PLATFORM_PROVIDER, QuotaExceeded, USER_PROVIDER, type ProviderSource, type QuotaUseCases, type UsageRepository } from '@techspar/core'
import { JoseTokenService } from '@techspar/platform'
import { CloudQuotaService } from './quota.ts'
import { registerCloudRoutes } from './routes.ts'
import { SubscriptionRepository } from './subscriptions.ts'

const DAY = 86_400_000

class StubUsage implements UsageRepository {
  constructor(public calls = 0) {}
  initialize(): void {}
  async record(): Promise<void> {}
  async platformCallsToday(): Promise<number> { return this.calls }
}

class StubBaseQuota implements QuotaUseCases {
  checked = 0
  async check(): Promise<void> { this.checked += 1 }
  async status(userId: string, source: ProviderSource) { return { source, used: 0, limit: 5 } }
  async record(): Promise<void> {}
}

let directory: string
let repository: SubscriptionRepository

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'techspar-cloud-'))
  repository = new SubscriptionRepository(join(directory, 'test.db'))
  repository.initialize()
})

afterEach(() => {
  repository.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('SubscriptionRepository', () => {
  test('未订阅时无有效期', () => {
    expect(repository.expiresAt('u1')).toBeNull()
    expect(repository.isActive('u1')).toBe(false)
    expect(repository.status('u1').active).toBe(false)
  })

  test('发放后生效,到期时间约为套餐天数之后', () => {
    const expiry = repository.grant('u1', 'month')
    expect(repository.isActive('u1')).toBe(true)
    expect(expiry.getTime() - Date.now()).toBeGreaterThan(29 * DAY)
    expect(expiry.getTime() - Date.now()).toBeLessThanOrEqual(30 * DAY)
  })

  test('续费从原到期时间往后接,不从现在重算', () => {
    const first = repository.grant('u1', 'month')
    const second = repository.grant('u1', 'month')
    expect(second.getTime() - first.getTime()).toBe(30 * DAY)
  })

  test('已过期的订阅续费从现在重新算', () => {
    repository.grant('u1', 'day')
    // 直接把到期时间改到过去,模拟过期
    const expired = new Date(Date.now() - 10 * DAY)
    repository.grant('u1', 'day')
    const database = repository as unknown as { sqlite: { query(sql: string): { run(params: Record<string, string>): void } } }
    database.sqlite.query('UPDATE cloud_subscriptions SET expires_at = $expiresAt WHERE user_id = $userId')
      .run({ $expiresAt: expired.toISOString(), $userId: 'u1' })
    expect(repository.isActive('u1')).toBe(false)

    const renewed = repository.grant('u1', 'day')
    expect(renewed.getTime()).toBeGreaterThan(Date.now())
    expect(renewed.getTime() - Date.now()).toBeLessThanOrEqual(DAY)
  })

  test('未知套餐被拒', () => {
    expect(() => repository.grant('u1', 'forever')).toThrow('unknown plan')
  })
})

describe('CloudQuotaService', () => {
  test('未订阅时委托给默认策略', async () => {
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(999), repository)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(base.checked).toBe(1)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBe(5)
  })

  test('非平台来源始终委托,不受订阅影响', async () => {
    repository.grant('u1', 'day')
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(999), repository)
    await quota.check('u1', USER_PROVIDER)
    expect(base.checked).toBe(1)
  })

  test('订阅用户默认不限量', async () => {
    repository.grant('u1', 'day')
    delete process.env.CLOUD_PAID_DAILY_CALL_LIMIT
    const base = new StubBaseQuota()
    const quota = new CloudQuotaService(base, new StubUsage(10_000), repository)
    await quota.check('u1', PLATFORM_PROVIDER)
    expect(base.checked).toBe(0)
    expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBeNull()
  })

  test('配了付费上限后订阅用户超额被拦', async () => {
    repository.grant('u1', 'day')
    process.env.CLOUD_PAID_DAILY_CALL_LIMIT = '100'
    try {
      const quota = new CloudQuotaService(new StubBaseQuota(), new StubUsage(100), repository)
      expect(quota.check('u1', PLATFORM_PROVIDER)).rejects.toThrow(QuotaExceeded)
      expect((await quota.status('u1', PLATFORM_PROVIDER)).limit).toBe(100)
    } finally {
      delete process.env.CLOUD_PAID_DAILY_CALL_LIMIT
    }
  })
})

describe('cloud routes', () => {
  const tokens = new JoseTokenService('test-secret-for-cloud-routes')

  function createTestApp(): OpenAPIHono {
    const app = new OpenAPIHono()
    app.onError((error, c) => {
      if (error instanceof AppError) return c.json({ detail: error.message }, error.status as 400)
      throw error
    })
    registerCloudRoutes(app, { subscriptions: repository, tokens })
    return app
  }

  test('订阅状态需要登录', async () => {
    const response = await createTestApp().request('/api/cloud/subscription')
    expect(response.status).toBe(401)
  })

  test('登录后返回状态与套餐', async () => {
    const token = await tokens.create('u1')
    const response = await createTestApp().request('/api/cloud/subscription', { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { active: boolean; plans: unknown[] }
    expect(body.active).toBe(false)
    expect(body.plans).toHaveLength(2)
  })

  test('没配 CLOUD_GRANT_SECRET 时发放接口整个关闭', async () => {
    delete process.env.CLOUD_GRANT_SECRET
    const response = await createTestApp().request('/api/cloud/subscription/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'u1', plan: 'day' }),
    })
    expect(response.status).toBe(404)
    expect(repository.isActive('u1')).toBe(false)
  })

  test('凭据不对不发放', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      const response = await createTestApp().request('/api/cloud/subscription/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cloud-secret': 'wrong' },
        body: JSON.stringify({ user_id: 'u1', plan: 'day' }),
      })
      expect(response.status).toBe(403)
      expect(repository.isActive('u1')).toBe(false)
    } finally {
      delete process.env.CLOUD_GRANT_SECRET
    }
  })

  test('凭据正确则发放订阅', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      const response = await createTestApp().request('/api/cloud/subscription/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cloud-secret': 'right' },
        body: JSON.stringify({ user_id: 'u1', plan: 'day' }),
      })
      expect(response.status).toBe(200)
      expect(repository.isActive('u1')).toBe(true)
    } finally {
      delete process.env.CLOUD_GRANT_SECRET
    }
  })

  test('未知套餐被拒且不发放', async () => {
    process.env.CLOUD_GRANT_SECRET = 'right'
    try {
      const response = await createTestApp().request('/api/cloud/subscription/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cloud-secret': 'right' },
        body: JSON.stringify({ user_id: 'u1', plan: 'forever' }),
      })
      expect(response.status).toBe(400)
      expect(repository.isActive('u1')).toBe(false)
    } finally {
      delete process.env.CLOUD_GRANT_SECRET
    }
  })
})
