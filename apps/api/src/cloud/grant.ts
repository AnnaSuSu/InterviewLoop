import type { UsageRepository } from '@techspar/core'
import type { SubscriptionRepository } from './subscriptions.ts'

export type GrantDependencies = { subscriptions: SubscriptionRepository; usage: UsageRepository }

/**
 * 发放订阅,并把上期没用完的 token 结转到本期。
 *
 * 和有效期一样只累加不清零:提前续费的人不该白白损失剩余额度,否则大家都会
 * 拖到用完才续,反而更容易在关键时刻断档。
 */
export async function grantWithCarryOver(
  userId: string,
  tierKey: string,
  months: number,
  deps: GrantDependencies,
): Promise<Date> {
  const active = deps.subscriptions.active(userId)
  let carried = 0
  if (active) {
    const used = await deps.usage.platformTokensSince(userId, active.periodStart)
    carried = Math.max(0, active.tokenQuota - used)
  }
  return deps.subscriptions.grant(userId, tierKey, months, carried)
}
