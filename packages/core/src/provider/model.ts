export const USER_PROVIDER = 'user' as const
export const PLATFORM_PROVIDER = 'platform' as const
// The upstream BAAI checkpoint does not ship the ONNX assets required by
// Transformers.js. This conversion keeps the same model while making local
// inference work in the TypeScript runtime.
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-m3'
export const DEFAULT_EMBEDDING_BATCH_SIZE = 10

export type ProviderSource = typeof USER_PROVIDER | typeof PLATFORM_PROVIDER

export type LlmCompatibility = 'generic' | 'deepseek'

export type LlmSettings = {
  api_base: string
  api_key: string
  model: string
  temperature: number
  compatibility: LlmCompatibility
}

export type EmbeddingSettings = {
  backend: '' | 'api' | 'local'
  api_base: string
  api_key: string
  api_model: string
  local_model: string
  local_path: string
  api_batch_size: number
}

export type ServiceSettings = {
  dashscope_api_key: string
  tavily_api_key: string
  oss_access_key_id: string
  oss_access_key_secret: string
  oss_bucket: string
  oss_endpoint: string
}

export type TrainingSettings = {
  num_questions: number
  divergence: number
}

export type SystemSettings = {
  allow_registration: boolean
}

export type ProviderStatus = { llm: boolean; embedding: boolean }

export type SettingsView = {
  llm: LlmSettings
  embedding: EmbeddingSettings
  services: ServiceSettings
  system: SystemSettings
  training: TrainingSettings
  is_admin: boolean
  configured: ProviderStatus
  last_reindex_at: string
}

export type ResolvedLlmConfig = LlmSettings & { source: ProviderSource }
export type ResolvedEmbeddingConfig = EmbeddingSettings & { source: ProviderSource }

export const emptyLlmSettings = (): LlmSettings => ({ api_base: '', api_key: '', model: '', temperature: 0.7, compatibility: 'generic' })
export const emptyEmbeddingSettings = (): EmbeddingSettings => ({
  backend: '', api_base: '', api_key: '', api_model: '', local_model: '', local_path: '', api_batch_size: DEFAULT_EMBEDDING_BATCH_SIZE,
})
export const emptyServiceSettings = (): ServiceSettings => ({
  dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '',
})
export const defaultTrainingSettings = (): TrainingSettings => ({ num_questions: 10, divergence: 3 })

export type PlatformProviderConfig = {
  llm: Pick<LlmSettings, 'api_base' | 'api_key' | 'model'> & { compatibility?: LlmCompatibility }
  embedding: Pick<EmbeddingSettings, 'api_base' | 'api_key' | 'api_model'>
  dailyCallLimit: number
  /** 每日 token 上限,0 表示不启用;设了就优先于 dailyCallLimit */
  dailyTokenLimit: number
}
