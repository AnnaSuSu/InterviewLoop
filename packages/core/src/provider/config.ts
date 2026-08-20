import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
  PLATFORM_PROVIDER,
  USER_PROVIDER,
  emptyEmbeddingSettings,
  emptyLlmSettings,
  type EmbeddingSettings,
  type LlmSettings,
  type PlatformProviderConfig,
  type ResolvedEmbeddingConfig,
  type ResolvedLlmConfig,
} from './model.ts'

export function normalizeEmbeddingApiBase(apiBase: string): string {
  const value = apiBase.trim().replace(/\/+$/, '')
  return value.replace(/\/embeddings$/i, '').replace(/\/+$/, '') || value
}

export function normalizeEmbeddingSettings(settings: EmbeddingSettings): EmbeddingSettings {
  const localModel = settings.local_model.trim()
  return {
    ...settings,
    api_base: normalizeEmbeddingApiBase(settings.api_base),
    local_model: localModel.toLocaleLowerCase() === 'baai/bge-m3' ? DEFAULT_EMBEDDING_MODEL : localModel,
    local_path: settings.local_path.trim(),
  }
}

export function embeddingModeOf(settings: EmbeddingSettings): 'api' | 'local' {
  if (settings.backend === 'api' || settings.backend === 'local') return settings.backend
  return settings.api_base || settings.api_key ? 'api' : 'local'
}

export function resolveLlmConfig(
  own: LlmSettings | undefined,
  platform: PlatformProviderConfig,
): ResolvedLlmConfig {
  if (own?.api_key && own.model) return { ...own, source: USER_PROVIDER }
  if (platform.llm.api_key && platform.llm.model) {
    return { ...platform.llm, temperature: 0.7, source: PLATFORM_PROVIDER }
  }
  return { ...emptyLlmSettings(), source: USER_PROVIDER }
}

export function resolveEmbeddingConfig(
  own: EmbeddingSettings | undefined,
  platform: PlatformProviderConfig,
): ResolvedEmbeddingConfig {
  const configured = own && Boolean(own.api_key || own.local_model || own.local_path || own.backend === 'local')
  if (configured) return { ...normalizeEmbeddingSettings(own), source: USER_PROVIDER }
  if (platform.embedding.api_key && platform.embedding.api_model) {
    return {
      ...emptyEmbeddingSettings(),
      backend: 'api',
      api_base: normalizeEmbeddingApiBase(platform.embedding.api_base),
      api_key: platform.embedding.api_key,
      api_model: platform.embedding.api_model,
      api_batch_size: DEFAULT_EMBEDDING_BATCH_SIZE,
      source: PLATFORM_PROVIDER,
    }
  }
  return { ...emptyEmbeddingSettings(), source: USER_PROVIDER }
}

export function embeddingTarget(settings: EmbeddingSettings): string {
  const normalized = normalizeEmbeddingSettings(settings)
  if (embeddingModeOf(normalized) === 'api') return normalized.api_model || DEFAULT_EMBEDDING_MODEL
  return normalized.local_path || normalized.local_model || DEFAULT_EMBEDDING_MODEL
}
