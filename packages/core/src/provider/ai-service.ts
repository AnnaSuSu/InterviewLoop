import type { RequestContext } from '../kernel/context.ts'
import { ProviderNotConfigured } from '../kernel/errors.ts'
import { resolveLlmConfig } from './config.ts'
import type { PlatformProviderConfig } from './model.ts'
import type {
  ChatDriverFactory,
  ChatMessage,
  ProviderSettingsRepository,
  QuotaUseCases,
  TextGenerationUseCases,
} from './ports.ts'

export class AiService implements TextGenerationUseCases {
  constructor(
    private readonly settings: ProviderSettingsRepository,
    private readonly platform: PlatformProviderConfig,
    private readonly quota: QuotaUseCases,
    private readonly chats: ChatDriverFactory,
  ) {}

  private async resolved(context: RequestContext) {
    const stored = context.userId ? await this.settings.loadProvider(context.userId) : undefined
    const config = resolveLlmConfig(stored?.llm, this.platform)
    if (!config.api_key || !config.model) throw new ProviderNotConfigured('LLM')
    return config
  }

  async complete(
    context: RequestContext,
    messages: readonly ChatMessage[],
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const config = await this.resolved(context)
    await this.quota.check(context.userId, config.source)
    const result = await this.chats.create(config).complete(messages, context.signal, options)
    await this.quota.record({
      userId: context.userId,
      source: config.source,
      model: config.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    })
    return result.text
  }

  async *stream(
    context: RequestContext,
    messages: readonly ChatMessage[],
    options?: { temperature?: number },
  ): AsyncIterable<string> {
    const config = await this.resolved(context)
    await this.quota.check(context.userId, config.source)
    try {
      yield* this.chats.create(config).stream(messages, context.signal, options)
    } finally {
      await this.quota.record({ userId: context.userId, source: config.source, model: config.model })
    }
  }
}
