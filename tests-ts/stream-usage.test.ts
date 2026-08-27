import { describe, expect, test } from 'bun:test'
import {
  AiService,
  type ChatDriver,
  type ChatDriverFactory,
  type ChatMessage,
  type ChatStreamOptions,
  type PlatformProviderConfig,
  type ProviderSettingsRepository,
  type ProviderSource,
  type QuotaStatus,
  type QuotaUseCases,
} from '@techspar/core'

const platform: PlatformProviderConfig = {
  llm: { api_base: 'https://example.test', api_key: 'k', model: 'm' },
  embedding: { api_base: '', api_key: '', api_model: '' },
  dailyCallLimit: 0,
  tokenLimit: 0,
  tokenWindow: 'day',
}

const settings: ProviderSettingsRepository = {
  async loadProvider() { return undefined },
  async saveProvider() {},
  async loadSystem() { return undefined },
  async saveSystem() {},
} as unknown as ProviderSettingsRepository

/** 在最后一个分片才报出用量,和真实流式接口一致。 */
class StreamingDriver implements ChatDriver {
  async complete() { return { text: '', promptTokens: 0, completionTokens: 0, cachedTokens: 0 } }
  async *stream(_messages: readonly ChatMessage[], _signal: AbortSignal, options?: ChatStreamOptions) {
    yield '答'
    yield '案'
    options?.onUsage?.({ promptTokens: 1200, completionTokens: 340, cachedTokens: 900 })
  }
}

class RecordingQuota implements QuotaUseCases {
  recorded: Array<{ promptTokens?: number; completionTokens?: number; cachedTokens?: number }> = []
  async check(): Promise<void> {}
  async status(_userId: string, source: ProviderSource): Promise<QuotaStatus> {
    return { source, used: 0, limit: null, unit: 'token', window: 'day' }
  }
  async record(input: { promptTokens?: number; completionTokens?: number; cachedTokens?: number }): Promise<void> {
    this.recorded.push(input)
  }
}

describe('流式调用的用量计量', () => {
  test('把流式报出的 token 记进用量,而不是记 0', async () => {
    // 曾经的漏洞:stream 路径不取 usage,一律记 0 token。按 token 计费时
    // 等于流式免费无限量,而流式恰恰是面试作答、Copilot 这些最贵的场景。
    const quota = new RecordingQuota()
    const factory: ChatDriverFactory = { create: () => new StreamingDriver() }
    const ai = new AiService(settings, platform, quota, factory)

    const chunks: string[] = []
    for await (const token of ai.stream({ requestId: 'r', userId: 'u1', signal: new AbortController().signal }, [{ role: 'user', content: '问' }])) {
      chunks.push(token)
    }

    expect(chunks.join('')).toBe('答案')
    expect(quota.recorded).toHaveLength(1)
    expect(quota.recorded[0]).toMatchObject({ promptTokens: 1200, completionTokens: 340, cachedTokens: 900 })
  })
})
