import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  defaultTrainingSettings,
  emptyServiceSettings,
  normalizeEmbeddingSettings,
  type ProviderSettingsRepository,
  type StoredProviderSettings,
  type TrainingSettings,
} from '@techspar/core'

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid user id')
  return value
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export class FileProviderSettingsRepository implements ProviderSettingsRepository {
  constructor(private readonly dataDir: string) {}

  private userDir(userId: string): string {
    return join(this.dataDir, 'users', safeSegment(userId))
  }

  async loadProvider(userId: string): Promise<StoredProviderSettings> {
    const value = await readJson<Partial<StoredProviderSettings>>(join(this.userDir(userId), 'provider.json'))
    return {
      ...(value?.llm ? { llm: value.llm } : {}),
      ...(value?.embedding ? { embedding: normalizeEmbeddingSettings(value.embedding) } : {}),
      services: value?.services || emptyServiceSettings(),
    }
  }

  async saveProvider(userId: string, value: StoredProviderSettings): Promise<void> {
    await atomicWriteJson(join(this.userDir(userId), 'provider.json'), {
      ...(value.llm ? { llm: value.llm } : {}),
      ...(value.embedding ? { embedding: normalizeEmbeddingSettings(value.embedding) } : {}),
      services: value.services,
    })
  }

  async loadTraining(userId: string): Promise<TrainingSettings> {
    return (await readJson<TrainingSettings>(join(this.userDir(userId), 'settings.json'))) || defaultTrainingSettings()
  }

  async saveTraining(userId: string, value: TrainingSettings): Promise<void> {
    await atomicWriteJson(join(this.userDir(userId), 'settings.json'), value)
  }

  async loadLastReindexAt(userId: string): Promise<string> {
    const value = await readJson<{ last_rebuild_at?: string }>(join(this.userDir(userId), 'index_meta.json'))
    return value?.last_rebuild_at || ''
  }

  async saveLastReindexAt(userId: string, value: string): Promise<void> {
    await atomicWriteJson(join(this.userDir(userId), 'index_meta.json'), { last_rebuild_at: value })
  }

  async loadSystem(): Promise<{ allow_registration: boolean } | undefined> {
    return readJson(join(this.dataDir, 'system_settings.json'))
  }

  async saveSystem(value: { allow_registration: boolean }): Promise<void> {
    await atomicWriteJson(join(this.dataDir, 'system_settings.json'), value)
  }
}
