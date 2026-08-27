import type { UsageRepository } from '@techspar/core'
import type { AfdianOrder } from './afdian.ts'
import type { OrderOutcome, OrderRepository } from './orders.ts'
import type { SubscriptionRepository } from './subscriptions.ts'
import { tierByPlanId } from './tiers.ts'

export type OrderDependencies = {
  orders: OrderRepository
  subscriptions: SubscriptionRepository
  usage: UsageRepository
  /** 校验 custom_order_id 确实是本站用户,避免给不存在的账号建订阅 */
  userExists: (userId: string) => Promise<boolean>
}

/**
 * 处理一笔爱发电订单。webhook 与定时对账共用,保证两条路径判断一致。
 *
 * 幂等由 orders 表兜底:同一 out_trade_no 只会真正发放一次,平台重复推送
 * 直接返回 already。
 */
export async function processOrder(
  order: AfdianOrder,
  deps: OrderDependencies,
): Promise<OrderOutcome | 'already'> {
  if (deps.orders.processed(order.out_trade_no)) return 'already'

  const months = Math.max(1, Math.floor(order.month ?? 1))
  const base = {
    outTradeNo: order.out_trade_no,
    planId: order.plan_id,
    months,
    amount: order.total_amount,
  }

  // 只认交易成功的订单。平台目前也只推 status=2,这里是防御性判断。
  if (order.status !== 2) {
    deps.orders.record({ ...base, outcome: 'ignored' })
    return 'ignored'
  }

  const tier = tierByPlanId(order.plan_id)
  if (!tier) {
    // 认不出档位宁可不发:发错档位比不发更难收场(用户已经拿到了更高额度)
    deps.orders.record({ ...base, outcome: 'unknown_plan' })
    return 'unknown_plan'
  }

  if (tier.donation) {
    // 纯赞助没有权益可发,但它是正常订单,不该混进待人工处理的队列里
    deps.orders.record({ ...base, tier: tier.key, outcome: 'ignored' })
    return 'ignored'
  }

  const userId = order.custom_order_id?.trim() ?? ''
  if (!userId || !(await deps.userExists(userId))) {
    // 落库待人工处理:钱已经收了,不能因为对不上账号就丢掉
    deps.orders.record({ ...base, userId, tier: tier.key, outcome: 'unmatched' })
    return 'unmatched'
  }

  deps.subscriptions.grant(userId, tier.key, months)
  deps.orders.record({ ...base, userId, tier: tier.key, outcome: 'granted' })
  return 'granted'
}
