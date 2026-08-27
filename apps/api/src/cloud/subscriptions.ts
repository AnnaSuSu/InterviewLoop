import { Database } from 'bun:sqlite'

export type Plan = { key: string; label: string; price_cents: number; days: number }

export const PLANS: readonly Plan[] = [
  { key: 'day', label: '体验 1 天', price_cents: 100, days: 1 },
  { key: 'month', label: '包月', price_cents: 990, days: 30 },
]

export type SubscriptionStatus = { active: boolean; expires_at: string | null; plans: Plan[] }

/**
 * 订阅有效期存储。
 *
 * 只管"这个用户付费到什么时候",不碰支付本身——收款成功后调用 grant() 即可,
 * 换支付渠道不影响这里。
 */
export class SubscriptionRepository {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS cloud_subscriptions (
        user_id    TEXT PRIMARY KEY,
        plan       TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }

  expiresAt(userId: string): Date | null {
    const row = this.sqlite
      .query<{ expires_at: string }, { $userId: string }>('SELECT expires_at FROM cloud_subscriptions WHERE user_id = $userId')
      .get({ $userId: userId })
    if (!row) return null
    const parsed = new Date(row.expires_at)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  isActive(userId: string): boolean {
    const expiry = this.expiresAt(userId)
    return expiry !== null && expiry.getTime() > Date.now()
  }

  /**
   * 付费成功后调用,返回新的到期时间。
   *
   * 续费从当前到期时间往后接,不是从现在重新算——否则提前续费的用户会白白
   * 损失剩余天数。
   */
  grant(userId: string, planKey: string): Date {
    const plan = PLANS.find((candidate) => candidate.key === planKey)
    if (!plan) throw new Error(`unknown plan: ${planKey}`)
    const now = Date.now()
    const current = this.expiresAt(userId)?.getTime() ?? now
    const base = current < now ? now : current
    const expiry = new Date(base + plan.days * 86_400_000)
    this.sqlite
      .query(`
        INSERT INTO cloud_subscriptions (user_id, plan, expires_at, updated_at)
        VALUES ($userId, $plan, $expiresAt, $updatedAt)
        ON CONFLICT(user_id) DO UPDATE SET
          plan = excluded.plan, expires_at = excluded.expires_at, updated_at = excluded.updated_at
      `)
      .run({ $userId: userId, $plan: plan.key, $expiresAt: expiry.toISOString(), $updatedAt: new Date(now).toISOString() })
    return expiry
  }

  status(userId: string): SubscriptionStatus {
    const expiry = this.expiresAt(userId)
    return {
      active: expiry !== null && expiry.getTime() > Date.now(),
      expires_at: expiry ? expiry.toISOString() : null,
      plans: [...PLANS],
    }
  }

  close(): void {
    this.sqlite.close()
  }
}
