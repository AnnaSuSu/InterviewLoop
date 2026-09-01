import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BunUsageRepository } from '@techspar/db'

const directories: string[] = []

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-usage-'))
  directories.push(directory)
  return join(directory, 'techspar.db')
}

afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})

describe('usage repository quota windows', () => {
  test('counts SQLite timestamps against ISO window boundaries', async () => {
    const path = await databasePath()
    const repository = new BunUsageRepository(path)
    repository.initialize()

    try {
      await repository.record({ userId: 'user-a', source: 'platform', model: 'model-a', promptTokens: 500, completionTokens: 200 })
      await repository.record({ userId: 'user-a', source: 'platform', model: 'model-a', promptTokens: 10, completionTokens: 20 })
      await repository.record({ userId: 'user-a', source: 'user', model: 'model-b', promptTokens: 100, completionTokens: 50 })
      await repository.record({ userId: 'user-a', source: 'platform', model: 'model-a', promptTokens: 1, completionTokens: 2 })

      const database = new Database(path)
      try {
        database.exec(`
          UPDATE llm_usage
          SET created_at = CASE id
            WHEN 1 THEN '2026-08-15 12:00:00'
            WHEN 2 THEN '2026-08-15 10:00:00'
            WHEN 3 THEN '2026-08-15 12:00:00'
            WHEN 4 THEN '2026-08-15 11:00:00'
          END
        `)
      } finally {
        database.close()
      }

      // created_at uses SQLite's space-separated format, while subscription
      // and monthly quota starts are passed in ISO-8601 format.
      expect(await repository.platformTokensSince('user-a', '2026-08-15T11:00:00.000Z')).toBe(703)
      expect(await repository.platformTokensSince('user-a', '2026-08-15T11:00:00.500Z')).toBe(700)
      expect(await repository.platformTokensSince('other-user', '2026-08-15T11:00:00.000Z')).toBe(0)
    } finally {
      repository.close()
    }
  })
})
