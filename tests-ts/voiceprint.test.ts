import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VoiceprintService, type RequestContext, type VoiceprintDriver, type VoiceprintDriverFactory } from '@techspar/core'
import { EncryptedFileVoiceprintRepository, voiceprintFromPortable, voiceprintToPortable } from '@techspar/platform'

const directories: string[] = []
async function directory(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'techspar-voiceprint-')); directories.push(value); return value }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })
const context: RequestContext = { requestId: 'voiceprint-test', userId: 'user-a', signal: new AbortController().signal }

function wave(pcmBytes = 64_000): Uint8Array {
  const bytes = new Uint8Array(44 + pcmBytes); const view = new DataView(bytes.buffer); const put = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset)
  put(0, 'RIFF'); view.setUint32(4, 36 + pcmBytes, true); put(8, 'WAVE'); put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, pcmBytes, true); return bytes
}

describe('voiceprint', () => {
  test('encrypts credentials at rest and preserves the legacy status shape', async () => {
    const root = await directory(); const repository = new EncryptedFileVoiceprintRepository(root, 'master-key')
    let deleted = ''
    const driver: VoiceprintDriver = { async ping() { return true }, async enroll() { return 'vp-1' }, async verify() { return { matched: true, score: 90 } }, async delete(id) { deleted = id; return true } }
    const factory: VoiceprintDriverFactory = { create() { return driver } }
    const service = new VoiceprintService(repository, factory)
    await service.credentials(context, { secret_id: 'secret-id', secret_key: 'secret-key', app_id: '' })
    const raw = await readFile(join(root, 'users', 'user-a', 'voiceprint.json'), 'utf8')
    expect(raw).not.toContain('secret-id'); expect(raw).not.toContain('secret-key')
    const portable = voiceprintToPortable(new TextEncoder().encode(raw), 'master-key')
    expect(new TextDecoder().decode(portable)).toContain('secret-id')
    const reencrypted = voiceprintFromPortable(portable, 'different-machine-key')
    expect(new TextDecoder().decode(reencrypted)).not.toContain('secret-id')
    expect(await service.status(context)).toEqual({ configured: true, enrolled: false, enrolled_at: null, speaker_nick: null })
    expect(await service.enroll(context, wave())).toMatchObject({ ok: true })
    expect(await service.status(context)).toMatchObject({ configured: true, enrolled: true, speaker_nick: 'techspar_user-a' })
    const detector = await service.detector(context); expect(await detector?.verify(new Uint8Array([1]))).toBe('candidate')
    await service.unenroll(context); expect(deleted).toBe('vp-1'); expect(await service.status(context)).toMatchObject({ configured: true, enrolled: false })
  })

  test('rejects invalid or short WAV before calling the provider', async () => {
    const root = await directory(); const repository = new EncryptedFileVoiceprintRepository(root, 'master-key')
    let enrollCalls = 0
    const factory: VoiceprintDriverFactory = { create() { return { async ping() { return true }, async enroll() { enrollCalls += 1; return 'vp' }, async verify() { return undefined }, async delete() { return true } } } }
    const service = new VoiceprintService(repository, factory); await service.credentials(context, { secret_id: 'id', secret_key: 'key', app_id: '' })
    await expect(service.enroll(context, new Uint8Array([1, 2]))).rejects.toThrow('WAV 解析失败')
    await expect(service.enroll(context, wave(1_000))).rejects.toThrow('录音太短')
    expect(enrollCalls).toBe(0)
  })
})
