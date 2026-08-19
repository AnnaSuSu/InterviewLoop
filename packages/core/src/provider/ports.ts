import type { RequestContext } from '../kernel/context.ts'
import type {
  ResolvedLlmConfig,
  ResolvedEmbeddingConfig,
  EmbeddingSettings,
  LlmSettings,
  ServiceSettings,
  SettingsView,
  TrainingSettings,
  ProviderSource,
} from './model.ts'

export type StoredProviderSettings = {
  llm?: LlmSettings
  embedding?: EmbeddingSettings
  services: ServiceSettings
}

export interface ProviderSettingsRepository {
  loadProvider(userId: string): Promise<StoredProviderSettings>
  saveProvider(userId: string, value: StoredProviderSettings): Promise<void>
  loadTraining(userId: string): Promise<TrainingSettings>
  saveTraining(userId: string, value: TrainingSettings): Promise<void>
  loadLastReindexAt(userId: string): Promise<string>
  saveLastReindexAt(userId: string, value: string): Promise<void>
  loadSystem(): Promise<{ allow_registration: boolean } | undefined>
  saveSystem(value: { allow_registration: boolean }): Promise<void>
}

export interface VectorIndexControl {
  invalidateUser(userId: string): Promise<void>
  resetEmbeddingClient(userId: string): void
}

export interface SettingsUseCases {
  get(context: RequestContext): Promise<SettingsView>
  update(context: RequestContext, value: SettingsView): Promise<{ ok: true; embedding_changed: boolean }>
  llmSource(context: RequestContext): Promise<ProviderSource>
}

export interface SettingsOperationsUseCases {
  testLlm(context: RequestContext, value: LlmSettings): Promise<{ ok: boolean; error?: string }>
  testEmbedding(context: RequestContext, value: EmbeddingSettings): Promise<{ ok: boolean; error?: string }>
  rebuildIndex(context: RequestContext): AsyncIterable<Record<string, unknown>>
}

export interface UsageRepository {
  initialize(): void
  record(input: { userId: string; source: ProviderSource; model: string; promptTokens: number; completionTokens: number }): Promise<void>
  platformCallsToday(userId: string): Promise<number>
}

export interface QuotaUseCases {
  check(userId: string | undefined, source: ProviderSource): Promise<void>
  status(userId: string, source: ProviderSource): Promise<{ source: ProviderSource; used: number; limit: number | null }>
  record(input: { userId?: string; source: ProviderSource; model?: string; promptTokens?: number; completionTokens?: number }): Promise<void>
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type ChatResult = { text: string; promptTokens: number; completionTokens: number }

export interface ChatDriver {
  complete(messages: readonly ChatMessage[], signal: AbortSignal, options?: { maxTokens?: number; temperature?: number }): Promise<ChatResult>
  stream(messages: readonly ChatMessage[], signal: AbortSignal, options?: { temperature?: number }): AsyncIterable<string>
}

export interface ChatDriverFactory {
  create(config: ResolvedLlmConfig): ChatDriver
}

export interface TextGenerationUseCases {
  complete(context: RequestContext, messages: readonly ChatMessage[], options?: { maxTokens?: number; temperature?: number }): Promise<string>
  stream(context: RequestContext, messages: readonly ChatMessage[], options?: { temperature?: number }): AsyncIterable<string>
}

export interface EmbeddingDriver {
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly Float32Array[]>
}

export interface EmbeddingDriverFactory {
  create(config: ResolvedEmbeddingConfig): Promise<EmbeddingDriver>
}

export interface EmbeddingUseCases {
  embed(context: RequestContext, texts: readonly string[]): Promise<readonly Float32Array[]>
  signature(context: RequestContext): Promise<string>
  reset(userId?: string): void
}
