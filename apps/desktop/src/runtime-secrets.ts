import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type RuntimeSecrets = { jwtSecret: string; voiceprintKey: string }

function valid(value: unknown): value is RuntimeSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.jwtSecret === 'string' && record.jwtSecret.length >= 64 && typeof record.voiceprintKey === 'string' && record.voiceprintKey.length >= 64
}

export async function loadOrCreateRuntimeSecrets(path: string): Promise<RuntimeSecrets> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!valid(value)) throw new Error('Desktop runtime secret file is invalid')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const value = { jwtSecret: randomBytes(32).toString('hex'), voiceprintKey: randomBytes(32).toString('hex') }
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  return value
}
