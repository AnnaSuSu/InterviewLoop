/**
 * 托管版档位。
 *
 * 四档功能完全相同,只有每日额度不同——不锁功能是这套定价的前提,别在这里
 * 引入"某档才有某能力"的字段。
 *
 * planId 是爱发电的方案 ID,回调靠它认出用户买的是哪一档;档位建好之前留空,
 * 此时 webhook 认不出方案会拒绝发放(宁可不发,也不能发错档)。
 */
export type Tier = {
  key: string
  planId: string
  label: string
  price_cents: number
  /** 订阅期内可用的 token 总量(输入+输出)。按次数计费与真实成本脱节:
   *  一次实时 Copilot 的上下文可能是普通问答的几十倍,却同样只算一次。 */
  token_quota: number
  /** 纯赞助档:不含任何权益,不发订阅,也不出现在付费墙里 */
  donation?: boolean
}

const MILLION = 1_000_000

/**
 * 默认档位。
 *
 * 额度按最坏情况估算:高峰时段、缓存不命中。注意输出的单价数倍于输入且占大头,
 * 拿输入价当基准会严重低估——这里踩过两次。
 *
 * 越往上每块钱买到的额度越多,否则没人有理由升级。
 */
const DEFAULT_TIERS: readonly Tier[] = [
  { key: 'basic', planId: '', label: '保持手感', price_cents: 990, token_quota: 0.8 * MILLION },
  { key: 'plus', planId: '', label: '在投简历了', price_cents: 1990, token_quota: 1.8 * MILLION },
  { key: 'season', planId: '', label: '面试季', price_cents: 3990, token_quota: 3.8 * MILLION },
  { key: 'sprint', planId: '', label: '全力冲刺', price_cents: 6990, token_quota: 7 * MILLION },
]

/** 一次赞助按多少天计。爱发电按月计费,月份数乘以这个天数。 */
export const DAYS_PER_MONTH = 30

let cached: readonly Tier[] | undefined

/**
 * 档位表。CLOUD_TIERS 配了就整体覆盖默认值(JSON 数组),没配则用默认档位——
 * 默认档位的 planId 是空的,填好爱发电方案 ID 才能自动发放。
 */
export function tiers(): readonly Tier[] {
  if (cached) return cached
  const raw = process.env.CLOUD_TIERS?.trim()
  if (!raw) return (cached = DEFAULT_TIERS)
  try {
    const parsed = JSON.parse(raw) as Tier[]
    if (!Array.isArray(parsed) || parsed.some((t) => !t.key || typeof t.token_quota !== 'number')) {
      throw new Error('每个档位至少需要 key 与数字 token_quota')
    }
    return (cached = parsed)
  } catch (error) {
    // 配错了直接抛:静默回落到默认档位会让线上按错误的价格和额度发放
    throw new Error(`CLOUD_TIERS 解析失败: ${(error as Error).message}`)
  }
}

export function tierByKey(key: string): Tier | undefined {
  return tiers().find((tier) => tier.key === key)
}

/** 付费墙里展示的档位:纯赞助档不含权益,列在这里只会让人以为买了能提额度。 */
export function purchasableTiers(): Tier[] {
  return tiers().filter((tier) => !tier.donation)
}

/** 按爱发电方案 ID 反查档位。planId 为空的档位不参与匹配,避免未配置时误命中。 */
export function tierByPlanId(planId: string): Tier | undefined {
  if (!planId) return undefined
  return tiers().find((tier) => tier.planId === planId)
}

/** 仅供测试:清掉进程内缓存,好让改过的 CLOUD_TIERS 生效。 */
export function resetTierCache(): void {
  cached = undefined
}
