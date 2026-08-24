import { PLATFORM_PROVIDER, QuotaExceeded, type ProviderSource, type QuotaUseCases, type UsageRepository } from '@techspar/core'
import type { SubscriptionRepository } from './subscriptions.ts'

/** 订阅用户的每日上限,0 表示不限。防的是单个账号写脚本把网关额度刷干。 */
function paidDailyLimit(): number {
  const parsed = Number(process.env.CLOUD_PAID_DAILY_CALL_LIMIT || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 订阅制配额策略,包装开源版默认实现。
 *
 * 未订阅一律委托给默认实现——免费额度的口径和文案只此一份,不在这里复述,
 * 否则改上限时两处会走偏。
 */
export class CloudQuotaService implements QuotaUseCases {
  constructor(
    private readonly base: QuotaUseCases,
    private readonly usage: UsageRepository,
    private readonly subscriptions: SubscriptionRepository,
  ) {}

  private subscribed(userId: string | undefined, source: ProviderSource): boolean {
    return !!userId && source === PLATFORM_PROVIDER && this.subscriptions.isActive(userId)
  }

  async check(userId: string | undefined, source: ProviderSource): Promise<void> {
    if (!this.subscribed(userId, source)) return this.base.check(userId, source)
    const limit = paidDailyLimit()
    if (limit <= 0) return
    const used = await this.usage.platformCallsToday(userId!)
    if (used >= limit) throw new QuotaExceeded(`今日调用已达上限(${used}/${limit}),明天再来。`)
  }

  async status(userId: string, source: ProviderSource): Promise<{ source: ProviderSource; used: number; limit: number | null }> {
    if (!this.subscribed(userId, source)) return this.base.status(userId, source)
    const limit = paidDailyLimit()
    return { source, used: await this.usage.platformCallsToday(userId), limit: limit > 0 ? limit : null }
  }

  async record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number }): Promise<void> {
    return this.base.record(input)
  }
}
