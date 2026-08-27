import { Database } from 'bun:sqlite'
import type { ProviderSource, UsageRepository } from '@techspar/core'

export class BunUsageRepository implements UsageRepository {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_lookup ON llm_usage (user_id, source, created_at);
    `)
  }

  async record(input: { userId: string; source: ProviderSource; model: string; promptTokens: number; completionTokens: number }): Promise<void> {
    this.sqlite.query(`
      INSERT INTO llm_usage (user_id, source, model, prompt_tokens, completion_tokens)
      VALUES ($userId, $source, $model, $promptTokens, $completionTokens)
    `).run({ $userId: input.userId, $source: input.source, $model: input.model, $promptTokens: input.promptTokens, $completionTokens: input.completionTokens })
  }

  async platformCallsToday(userId: string): Promise<number> {
    const row = this.sqlite.query<{ count: number }, { $userId: string }>(`
      SELECT COUNT(*) AS count FROM llm_usage
      WHERE user_id = $userId AND source = 'platform' AND date(created_at) = date('now')
    `).get({ $userId: userId })
    return row?.count || 0
  }

  async platformTokensToday(userId: string): Promise<number> {
    const row = this.sqlite.query<{ total: number | null }, { $userId: string }>(`
      SELECT SUM(prompt_tokens + completion_tokens) AS total FROM llm_usage
      WHERE user_id = $userId AND source = 'platform' AND date(created_at) = date('now')
    `).get({ $userId: userId })
    return row?.total || 0
  }

  async platformTokensSince(userId: string, since: string): Promise<number> {
    const row = this.sqlite.query<{ total: number | null }, { $userId: string; $since: string }>(`
      SELECT SUM(prompt_tokens + completion_tokens) AS total FROM llm_usage
      WHERE user_id = $userId AND source = 'platform' AND created_at >= $since
    `).get({ $userId: userId, $since: since })
    return row?.total || 0
  }

  close(): void {
    this.sqlite.close()
  }
}
