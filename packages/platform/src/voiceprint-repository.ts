import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VoiceprintConfig, VoiceprintCredentials, VoiceprintRepository } from '@techspar/core'
import { atomicWriteJson } from './provider-settings-repository.ts'

type Sealed = { iv: string; tag: string; ciphertext: string }
type Stored = { version?: number; credentials?: VoiceprintCredentials; credentials_encrypted?: Sealed; enrollment?: VoiceprintConfig['enrollment'] }
function segment(value: string): string { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid user id'); return value }
function keyFrom(masterKey: string): Buffer { if (!masterKey) throw new Error('VOICEPRINT_ENCRYPTION_KEY or JWT_SECRET is required'); return createHash('sha256').update(masterKey).digest() }
function seal(key: Buffer, value: VoiceprintCredentials): Sealed { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') } }
function open(key: Buffer, value: Sealed): VoiceprintCredentials { const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64')); decipher.setAuthTag(Buffer.from(value.tag, 'base64')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as VoiceprintCredentials }
function decode(bytes: Uint8Array, key: Buffer): VoiceprintConfig { const stored = JSON.parse(new TextDecoder().decode(bytes)) as Stored; const credentials = stored.credentials_encrypted ? open(key, stored.credentials_encrypted) : stored.credentials; return { ...(credentials ? { credentials: { ...credentials, app_id: credentials.app_id || '' } } : {}), ...(stored.enrollment ? { enrollment: stored.enrollment } : {}) } }
function encode(value: VoiceprintConfig, key: Buffer): Uint8Array { return new TextEncoder().encode(`${JSON.stringify({ version: 2, ...(value.credentials ? { credentials_encrypted: seal(key, value.credentials) } : {}), ...(value.enrollment ? { enrollment: value.enrollment } : {}) }, null, 2)}\n`) }

export function voiceprintToPortable(bytes: Uint8Array, masterKey: string): Uint8Array { const value = decode(bytes, keyFrom(masterKey)); return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`) }
export function voiceprintFromPortable(bytes: Uint8Array, masterKey: string): Uint8Array { return encode(decode(bytes, keyFrom(masterKey)), keyFrom(masterKey)) }

export class EncryptedFileVoiceprintRepository implements VoiceprintRepository {
  private readonly key: Buffer
  constructor(private readonly dataDir: string, masterKey: string) {
    this.key = keyFrom(masterKey)
  }
  private path(userId: string): string { return join(this.dataDir, 'users', segment(userId), 'voiceprint.json') }
  async load(userId: string): Promise<VoiceprintConfig> {
    let stored: Stored
    try { stored = JSON.parse(await readFile(this.path(userId), 'utf8')) as Stored }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
    const credentials = stored.credentials_encrypted ? open(this.key, stored.credentials_encrypted) : stored.credentials
    return { ...(credentials ? { credentials: { ...credentials, app_id: credentials.app_id || '' } } : {}), ...(stored.enrollment ? { enrollment: stored.enrollment } : {}) }
  }
  async save(userId: string, value: VoiceprintConfig): Promise<void> {
    await atomicWriteJson(this.path(userId), { version: 2, ...(value.credentials ? { credentials_encrypted: seal(this.key, value.credentials) } : {}), ...(value.enrollment ? { enrollment: value.enrollment } : {}) })
  }
}
