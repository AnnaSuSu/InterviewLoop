import { QuotaExceeded } from '../kernel/errors.ts'
import { PLATFORM_PROVIDER, type PlatformProviderConfig, type ProviderSource } from './model.ts'
import type { QuotaStatus, QuotaUseCases, QuotaUnit, QuotaWindow, UsageRepository } from './ports.ts'

/**
 * 平台额度。
 *
 * 优先按 token 计量:按次数算与真实成本严重脱节——一次实时 Copilot 的上下文
 * 可能是一次普通问答的几十倍,却同样只记一次。配了 dailyTokenLimit 就走 token,
 * 否则回落到 dailyCallLimit,老部署的配置不受影响。
 */
export class QuotaService implements QuotaUseCases {
  constructor(
    private readonly usage: UsageRepository,
    private readonly platform: PlatformProviderConfig,
  ) {}

  private get unit(): QuotaUnit {
    return this.platform.tokenLimit > 0 ? 'token' : 'call'
  }

  private get window(): QuotaWindow {
    return this.unit === 'token' ? this.platform.tokenWindow : 'day'
  }

  private get limit(): number {
    return this.unit === 'token' ? this.platform.tokenLimit : this.platform.dailyCallLimit
  }

  /** 本月起点。按月窗口时用它界定用量,跨月自动归零。 */
  private static monthStart(): string {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  }

  private async usedInWindow(userId: string): Promise<number> {
    if (this.unit !== 'token') return this.usage.platformCallsToday(userId)
    return this.window === 'month'
      ? this.usage.platformTokensSince(userId, QuotaService.monthStart())
      : this.usage.platformTokensToday(userId)
  }

  async check(userId: string | undefined, source: ProviderSource): Promise<void> {
    if (!userId || source !== PLATFORM_PROVIDER || this.limit <= 0) return
    const used = await this.usedInWindow(userId)
    if (used >= this.limit) {
      const span = this.window === 'month' ? '本月' : '今日'
      throw new QuotaExceeded(`${span}平台额度已用完。可以在「设置」里填自己的 API Key 继续免费使用。`)
    }
  }

  async status(userId: string, source: ProviderSource): Promise<QuotaStatus> {
    if (source !== PLATFORM_PROVIDER) return { source, used: 0, limit: null, unit: this.unit, window: this.window }
    return {
      source,
      used: await this.usedInWindow(userId),
      limit: this.limit > 0 ? this.limit : null,
      unit: this.unit,
      window: this.window,
    }
  }

  async record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number; cachedTokens?: number }): Promise<void> {
    if (!input.userId) return
    try {
      await this.usage.record({
        userId: input.userId,
        source: input.source,
        model: input.model || '',
        promptTokens: input.promptTokens || 0,
        completionTokens: input.completionTokens || 0,
        cachedTokens: input.cachedTokens || 0,
      })
    } catch (error) {
      console.error('记录 LLM 用量失败', error)
    }
  }
}
