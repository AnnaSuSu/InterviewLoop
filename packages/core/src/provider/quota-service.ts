import { QuotaExceeded } from '../kernel/errors.ts'
import { PLATFORM_PROVIDER, type PlatformProviderConfig, type ProviderSource } from './model.ts'
import type { QuotaUseCases, UsageRepository } from './ports.ts'

export class QuotaService implements QuotaUseCases {
  constructor(
    private readonly usage: UsageRepository,
    private readonly platform: PlatformProviderConfig,
  ) {}

  async check(userId: string | undefined, source: ProviderSource): Promise<void> {
    if (!userId || source !== PLATFORM_PROVIDER || this.platform.dailyCallLimit <= 0) return
    const used = await this.usage.platformCallsToday(userId)
    if (used >= this.platform.dailyCallLimit) {
      throw new QuotaExceeded(`今日平台额度已用完(${used}/${this.platform.dailyCallLimit})。可以在「设置」里填自己的 API Key 继续免费使用。`)
    }
  }

  async status(userId: string, source: ProviderSource): Promise<{ source: ProviderSource; used: number; limit: number | null }> {
    if (source !== PLATFORM_PROVIDER) return { source, used: 0, limit: null }
    return {
      source,
      used: await this.usage.platformCallsToday(userId),
      limit: this.platform.dailyCallLimit > 0 ? this.platform.dailyCallLimit : null,
    }
  }

  async record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number }): Promise<void> {
    if (!input.userId) return
    try {
      await this.usage.record({
        userId: input.userId,
        source: input.source,
        model: input.model || '',
        promptTokens: input.promptTokens || 0,
        completionTokens: input.completionTokens || 0,
      })
    } catch (error) {
      console.error('记录 LLM 用量失败', error)
    }
  }
}
