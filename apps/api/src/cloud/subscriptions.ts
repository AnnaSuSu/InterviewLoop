import { Database } from 'bun:sqlite'
import { DAYS_PER_MONTH, purchasableTiers, tierByKey, type Tier } from './tiers.ts'

export type SubscriptionStatus = {
  active: boolean
  expires_at: string | null
  /** 当前生效的档位 key,未订阅为 null */
  tier: string | null
  plans: Tier[]
}

const DAY_MS = 86_400_000

/**
 * 订阅有效期存储。
 *
 * 只管"这个用户付费到什么时候、哪一档",不碰支付本身——收款成功后调用
 * grant() 即可,换收款渠道不影响这里。
 */
export class SubscriptionRepository {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
  }

  initialize(): void {
    // 列名沿用 plan(存档位 key),避免给已有部署加一次迁移
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS cloud_subscriptions (
        user_id    TEXT PRIMARY KEY,
        plan       TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }

  private row(userId: string): { plan: string; expires_at: string } | null {
    return this.sqlite
      .query<{ plan: string; expires_at: string }, { $userId: string }>(
        'SELECT plan, expires_at FROM cloud_subscriptions WHERE user_id = $userId',
      )
      .get({ $userId: userId })
  }

  expiresAt(userId: string): Date | null {
    const row = this.row(userId)
    if (!row) return null
    const parsed = new Date(row.expires_at)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  isActive(userId: string): boolean {
    const expiry = this.expiresAt(userId)
    return expiry !== null && expiry.getTime() > Date.now()
  }

  /** 当前生效的档位;已过期或从未订阅都返回 null。 */
  activeTier(userId: string): Tier | null {
    const row = this.row(userId)
    if (!row) return null
    const expiry = new Date(row.expires_at)
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) return null
    return tierByKey(row.plan) ?? null
  }

  /**
   * 付费成功后调用,返回新的到期时间。
   *
   * 续费从当前到期时间往后接,不是从现在重新算——否则提前续费的用户会白白
   * 损失剩余天数。换档位时同样顺延:剩余时间按新档位继续用,不折算、不清零。
   */
  grant(userId: string, tierKey: string, months = 1): Date {
    const tier = tierByKey(tierKey)
    if (!tier) throw new Error(`unknown tier: ${tierKey}`)
    const span = Math.max(1, Math.floor(months)) * DAYS_PER_MONTH * DAY_MS
    const now = Date.now()
    const current = this.expiresAt(userId)?.getTime() ?? now
    const expiry = new Date((current < now ? now : current) + span)
    this.sqlite
      .query(`
        INSERT INTO cloud_subscriptions (user_id, plan, expires_at, updated_at)
        VALUES ($userId, $plan, $expiresAt, $updatedAt)
        ON CONFLICT(user_id) DO UPDATE SET
          plan = excluded.plan, expires_at = excluded.expires_at, updated_at = excluded.updated_at
      `)
      .run({ $userId: userId, $plan: tier.key, $expiresAt: expiry.toISOString(), $updatedAt: new Date(now).toISOString() })
    return expiry
  }

  status(userId: string): SubscriptionStatus {
    const expiry = this.expiresAt(userId)
    const active = expiry !== null && expiry.getTime() > Date.now()
    return {
      active,
      expires_at: expiry ? expiry.toISOString() : null,
      tier: active ? (this.row(userId)?.plan ?? null) : null,
      plans: purchasableTiers(),
    }
  }

  close(): void {
    this.sqlite.close()
  }
}
