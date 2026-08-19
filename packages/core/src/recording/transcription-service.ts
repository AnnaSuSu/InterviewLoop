import type { RequestContext } from '../kernel/context.ts'
import type { ProviderSettingsRepository } from '../provider/ports.ts'
import type { ShortTranscriptionUseCases } from '../resume/ports.ts'
import type { ServiceSettings } from '../provider/model.ts'

export interface ShortAsrDriver {
  transcribe(input: { apiKey: string; bytes: Uint8Array; suffix: string; signal: AbortSignal }): Promise<string>
}

export interface LongAsrDriver {
  transcribe(input: { services: ServiceSettings; bytes: Uint8Array; suffix: string; signal: AbortSignal }): Promise<string>
}

export interface LongTranscriptionUseCases {
  transcribe(context: RequestContext, bytes: Uint8Array, suffix: string): Promise<string>
}

export class ShortTranscriptionService implements ShortTranscriptionUseCases {
  constructor(
    private readonly settings: ProviderSettingsRepository,
    private readonly driver: ShortAsrDriver,
  ) {}

  async transcribe(context: RequestContext, bytes: Uint8Array, suffix: string): Promise<string> {
    if (!context.userId) throw new Error('DASHSCOPE_API_KEY not configured')
    const apiKey = (await this.settings.loadProvider(context.userId)).services.dashscope_api_key
    if (!apiKey) throw new Error('DASHSCOPE_API_KEY not configured')
    if (bytes.length > 7 * 1024 * 1024) throw new Error(`audio too large for sync endpoint: ${bytes.length} bytes (limit ${7 * 1024 * 1024}); use transcribe_long instead`)
    return this.driver.transcribe({ apiKey, bytes, suffix, signal: context.signal })
  }
}

export class LongTranscriptionService implements LongTranscriptionUseCases {
  constructor(
    private readonly settings: ProviderSettingsRepository,
    private readonly driver: LongAsrDriver,
  ) {}

  async transcribe(context: RequestContext, bytes: Uint8Array, suffix: string): Promise<string> {
    if (!context.userId) throw new Error('DASHSCOPE_API_KEY not configured')
    if (!bytes.length) throw new Error('empty audio payload')
    const services = (await this.settings.loadProvider(context.userId)).services
    const required: Array<[string, string]> = [
      ['DASHSCOPE_API_KEY', services.dashscope_api_key],
      ['ALIYUN_OSS_ACCESS_KEY_ID', services.oss_access_key_id],
      ['ALIYUN_OSS_ACCESS_KEY_SECRET', services.oss_access_key_secret],
      ['ALIYUN_OSS_BUCKET', services.oss_bucket],
      ['ALIYUN_OSS_ENDPOINT', services.oss_endpoint],
    ]
    const missing = required.filter(([, value]) => !value.trim()).map(([name]) => name)
    if (missing.length) throw new Error(`Alibaba OSS not configured: missing ${missing.join(', ')}`)
    return this.driver.transcribe({ services, bytes, suffix, signal: context.signal })
  }
}
