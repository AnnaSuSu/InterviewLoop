import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultProfile, type CandidateProfile, type CandidateProfileRepository } from '@techspar/core'
import { atomicWriteJson } from './provider-settings-repository.ts'

function segment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid user id')
  return value
}

export class FileCandidateProfileRepository implements CandidateProfileRepository {
  private readonly tails = new Map<string, Promise<void>>()

  constructor(private readonly dataDir: string) {}

  private path(userId: string): string { return join(this.dataDir, 'users', segment(userId), 'profile', 'profile.json') }

  async load(userId: string): Promise<CandidateProfile> {
    try { return JSON.parse(await readFile(this.path(userId), 'utf8')) as CandidateProfile }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultProfile(); throw error }
  }

  async save(userId: string, profile: CandidateProfile): Promise<void> {
    await this.exclusive(userId, async () => this.write(userId, profile))
  }

  async update<T>(userId: string, mutate: (profile: CandidateProfile) => T | Promise<T>): Promise<T> {
    return this.exclusive(userId, async () => {
      const profile = await this.load(userId)
      const result = await mutate(profile)
      await this.write(userId, profile)
      return result
    })
  }

  private async write(userId: string, profile: CandidateProfile): Promise<void> {
    profile.updated_at = new Date().toISOString()
    await atomicWriteJson(this.path(userId), profile)
  }

  private async exclusive<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(userId) || Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(userId, tail)
    await previous
    try { return await work() }
    finally { release(); if (this.tails.get(userId) === tail) this.tails.delete(userId) }
  }
}
