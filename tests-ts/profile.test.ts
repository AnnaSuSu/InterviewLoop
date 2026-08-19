import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultProfile, sm2Update, type CandidateProfile } from '@techspar/core'
import { FileCandidateProfileRepository } from '@techspar/platform'

const directories: string[] = []
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'techspar-profile-')); directories.push(path); return path }
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })

describe('profile persistence', () => {
  test('atomically replaces profile.json with compatible defaults', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    const profile = defaultProfile(); profile.name = 'A'; profile.topic_mastery.python = { score: 72 }
    await repository.save('user-a', profile)
    expect(await repository.load('user-a')).toMatchObject({ name: 'A', topic_mastery: { python: { score: 72 } } })
    expect(JSON.parse(await readFile(join(root, 'users/user-a/profile/profile.json'), 'utf8'))).toMatchObject({ name: 'A' })
  })

  test('keeps the existing file and cleans temporary files on serialization failure', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    const profile = defaultProfile(); profile.name = 'before'; await repository.save('user-a', profile)
    const invalid = { ...profile, invalid: 1n } as unknown as CandidateProfile
    await expect(repository.save('user-a', invalid)).rejects.toThrow()
    expect((await repository.load('user-a')).name).toBe('before')
    expect((await readdir(join(root, 'users/user-a/profile'))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('serializes concurrent read-modify-write updates per user', async () => {
    const root = await directory()
    const repository = new FileCandidateProfileRepository(root)
    await Promise.all(Array.from({ length: 20 }, () => repository.update('user-a', async (profile) => {
      const value = profile.stats.total_sessions
      await new Promise((resolve) => setTimeout(resolve, 1))
      profile.stats.total_sessions = value + 1
    })))
    expect((await repository.load('user-a')).stats.total_sessions).toBe(20)
  })
})

describe('spaced repetition', () => {
  test('keeps the Python SM-2 thresholds and intervals', () => {
    const today = new Date('2026-08-19T00:00:00Z')
    const first = sm2Update({}, 7, today)
    const second = sm2Update(first, 8, today)
    const failed = sm2Update(second, 4, today)
    expect(first).toMatchObject({ interval_days: 1, repetitions: 1, next_review: '2026-08-20' })
    expect(second).toMatchObject({ interval_days: 3, repetitions: 2, next_review: '2026-08-22' })
    expect(failed).toMatchObject({ interval_days: 1, repetitions: 0 })
  })
})
