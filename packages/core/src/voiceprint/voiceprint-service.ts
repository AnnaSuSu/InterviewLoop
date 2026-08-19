import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import type { VoiceprintCredentials } from './model.ts'
import type { VoiceRoleDetector, VoiceprintDriverFactory, VoiceprintRepository, VoiceprintUseCases } from './ports.ts'

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function pcmFromWav(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 44 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WAVE') throw new AppError('WAV 解析失败：不是合法的 WAV 文件', 400)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = new TextDecoder().decode(bytes.slice(offset, offset + 4)); const size = view.getUint32(offset + 4, true); const start = offset + 8
    if (start + size > bytes.length) throw new AppError('WAV 解析失败：数据块损坏', 400)
    if (type === 'data') return bytes.slice(start, start + size)
    offset = start + size + (size % 2)
  }
  throw new AppError('WAV 解析失败：WAV 文件中未找到 data 块', 400)
}

export class VoiceprintService implements VoiceprintUseCases {
  constructor(private readonly repository: VoiceprintRepository, private readonly drivers: VoiceprintDriverFactory) {}
  async status(context: RequestContext) {
    const value = await this.repository.load(id(context)); return { configured: Boolean(value.credentials?.secret_id && value.credentials.secret_key), enrolled: Boolean(value.enrollment?.voice_print_id), enrolled_at: value.enrollment?.enrolled_at || null, speaker_nick: value.enrollment?.speaker_nick || null }
  }
  async credentials(context: RequestContext, value: VoiceprintCredentials): Promise<{ ok: true }> {
    const userId = id(context); const normalized = { secret_id: value.secret_id.trim(), secret_key: value.secret_key.trim(), app_id: (value.app_id || '').trim() }
    if (!normalized.secret_id || !normalized.secret_key || !(await this.drivers.create(normalized).ping())) throw new AppError('腾讯云凭据无效或网络不通，请检查 SecretId / SecretKey', 400)
    const current = await this.repository.load(userId); await this.repository.save(userId, { ...current, credentials: normalized }); return { ok: true }
  }
  async enroll(context: RequestContext, wavBytes: Uint8Array): Promise<{ ok: true; enrolled_at: string }> {
    const userId = id(context); const current = await this.repository.load(userId)
    if (!current.credentials) throw new AppError('请先在设置页配置腾讯云凭据', 400)
    if (!wavBytes.length) throw new AppError('上传文件为空', 400)
    const pcm = pcmFromWav(wavBytes); if (pcm.length < 64_000) throw new AppError('录音太短，至少 2 秒', 400)
    const speakerNick = `techspar_${userId}`; const voicePrintId = await this.drivers.create(current.credentials).enroll(speakerNick, pcm)
    if (!voicePrintId) throw new AppError('腾讯云声纹注册失败，请检查日志', 500)
    const enrolledAt = new Date().toISOString(); await this.repository.save(userId, { ...current, enrollment: { voice_print_id: voicePrintId, speaker_nick: speakerNick, enrolled_at: enrolledAt } })
    return { ok: true, enrolled_at: enrolledAt }
  }
  async unenroll(context: RequestContext): Promise<{ ok: true }> {
    const userId = id(context); const current = await this.repository.load(userId)
    if (current.credentials && current.enrollment) await this.drivers.create(current.credentials).delete(current.enrollment.voice_print_id).catch(() => false)
    await this.repository.save(userId, { ...(current.credentials ? { credentials: current.credentials } : {}) }); return { ok: true }
  }
  async detector(context: RequestContext): Promise<VoiceRoleDetector | undefined> {
    const current = await this.repository.load(id(context)); if (!current.credentials || !current.enrollment) return undefined
    const driver = this.drivers.create(current.credentials); const voicePrintId = current.enrollment.voice_print_id
    return { async verify(pcmBytes) { const result = await driver.verify(voicePrintId, pcmBytes); return result ? result.matched ? 'candidate' : 'hr' : undefined } }
  }
}
