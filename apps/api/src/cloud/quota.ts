import { PLATFORM_PROVIDER, QuotaExceeded, type ProviderSource, type QuotaUseCases, type UsageRepository } from '@techspar/core'
import type { SubscriptionRepository } from './subscriptions.ts'
import type { Tier } from './tiers.ts'

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

  /** 该用户当下适用的付费档位;非平台来源或未订阅都返回 null,交回默认策略。 */
  private tier(userId: string | undefined, source: ProviderSource): Tier | null {
    if (!userId || source !== PLATFORM_PROVIDER) return null
    return this.subscriptions.activeTier(userId)
  }

  async check(userId: string | undefined, source: ProviderSource): Promise<void> {
    const tier = this.tier(userId, source)
    if (!tier) return this.base.check(userId, source)
    if (tier.daily_limit <= 0) return
    const used = await this.usage.platformCallsToday(userId!)
    if (used >= tier.daily_limit) {
      throw new QuotaExceeded(`今日调用已达上限(${used}/${tier.daily_limit}),明天再来。`)
    }
  }

  async status(userId: string, source: ProviderSource): Promise<{ source: ProviderSource; used: number; limit: number | null }> {
    const tier = this.tier(userId, source)
    if (!tier) return this.base.status(userId, source)
    return {
      source,
      used: await this.usage.platformCallsToday(userId),
      limit: tier.daily_limit > 0 ? tier.daily_limit : null,
    }
  }

  async record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number }): Promise<void> {
    return this.base.record(input)
  }
}
