import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync, gzipSync } from 'fflate'
import { DataMigrationService, defaultProfile, type RequestContext, type UserRepository } from '@techspar/core'
import { BunDataMigrationRepository, BunInterviewSessionRepository, BunPersonalAgentRepository } from '@techspar/db'
import { FileCandidateProfileRepository, FileMigrationStore, TarGzipArchiveCodec, atomicWriteJson } from '@techspar/platform'

const roots: string[] = []
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'techspar-migration-')); roots.push(value); return value }
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
const context = (userId: string): RequestContext => ({ requestId: 'test', userId, signal: new AbortController().signal })
const users: UserRepository = {
  async findByEmail() { return undefined }, async findById(id) { return { id, email: 'user@example.com', name: '', is_admin: id === 'admin' } }, async create() { throw new Error() },
}
function service(base: string) {
  const data = join(base, 'data'); mkdirSync(data, { recursive: true }); const db = join(data, 'interviews.db'); const profiles = new FileCandidateProfileRepository(data)
  return { db, profiles, value: new DataMigrationService({ codec: new TarGzipArchiveCodec(), database: new BunDataMigrationRepository(db), files: new FileMigrationStore(data), profiles, users }) }
}

describe('tar.gz archive safety', () => {
  test('round-trips version 2 manifests and rejects traversal paths', async () => {
    const codec = new TarGzipArchiveCodec()
    const bytes = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map([['data/users/user-a/notes.md', new TextEncoder().encode('notes')]]) })
    expect((await codec.unpack(bytes)).manifest?.schema_version).toBe(2)
    const tar = gunzipSync(bytes); tar.set(new TextEncoder().encode('../evil'), 0)
    await expect(codec.unpack(gzipSync(tar))).rejects.toThrow('越界路径')
  })

  test('rejects corrupt headers and archives beyond the expanded-size limit', async () => {
    const codec = new TarGzipArchiveCodec()
    const bytes = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map() })
    const corrupt = gunzipSync(bytes); corrupt[12] = corrupt[12]! ^ 1
    await expect(codec.unpack(gzipSync(corrupt))).rejects.toThrow('校验失败')

    const oversized = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map([['data/users/user-a/large.txt', new Uint8Array(4096)]]) })
    await expect(new TarGzipArchiveCodec(1024).unpack(oversized)).rejects.toThrow('解压后过大')
  })

  test('exports a consistent full-system SQLite snapshot', async () => {
    const base = await root(); const { db } = service(base)
    const database = new Database(db, { create: true }); database.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('kept')"); database.close()
    const bytes = await new BunDataMigrationRepository(db).exportSystem()
    expect(bytes?.length).toBeGreaterThan(0)
    const snapshotPath = join(base, 'snapshot.db'); await Bun.write(snapshotPath, bytes!)
    const snapshot = new Database(snapshotPath, { readonly: true })
    expect(snapshot.query<{ value: string }, []>('SELECT value FROM sample').get()?.value).toBe('kept')
    snapshot.close()
  })
})

describe('personal archive migration', () => {
  test('exports only owned portable data, rebinds it, and excludes credentials by default', async () => {
    const sourceRoot = await root(); const source = service(sourceRoot)
    const sessions = new BunInterviewSessionRepository(source.db); sessions.initialize()
    await sessions.create({ sessionId: 's1', userId: 'source-user', mode: 'topic_drill', topic: 'python' }); await sessions.updateStatus('s1', 'source-user', 'reviewed'); await sessions.saveReview({ sessionId: 's1', userId: 'source-user', review: 'good', scores: [{ question_id: 1, score: 8 }], overall: { avg_score: 8 } })
    await sessions.create({ sessionId: 'other', userId: 'other-user', mode: 'resume' })
    const personal = new BunPersonalAgentRepository(source.db); personal.initialize()
    await personal.createDocument({ documentId: 'd1', userId: 'source-user', filename: 'notes.md', storedName: 'd1.md', extension: '.md', sizeBytes: 5 })
    await personal.createConversation({ conversationId: 'c1', userId: 'source-user', title: '成长计划' })
    const profile = defaultProfile(); profile.name = 'Source'; profile.stats.total_sessions = 5; profile.weak_points.push({ point: 'GIL', topic: 'python', times_seen: 1 })
    await source.profiles.save('source-user', profile)
    await new FileMigrationStore(join(sourceRoot, 'data')).write('source-user', 'library/d1.md', new TextEncoder().encode('notes'))
    await atomicWriteJson(join(sourceRoot, 'data/users/source-user/provider.json'), { api_key: 'secret' })
    const exported = await source.value.exportPersonal(context('source-user'), false)
    const archive = await new TarGzipArchiveCodec().unpack(exported.bytes)
    expect([...archive.files.keys()]).not.toContain('data/users/source-user/provider.json')

    const targetRoot = await root(); const target = service(targetRoot)
    const result = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'skip', overwriteFiles: false })
    expect(result).toMatchObject({ db_inserted: 3, db_skipped: 0, requires_reindex: true })
    const database = new Database(target.db, { readonly: true })
    expect(database.query<{ user_id: string }, []>("SELECT user_id FROM sessions WHERE session_id = 's1'").get()?.user_id).toBe('target-user')
    expect(database.query<{ user_id: string }, []>("SELECT user_id FROM personal_documents WHERE document_id = 'd1'").get()?.user_id).toBe('target-user')
    expect(database.query<{ user_id: string }, []>("SELECT user_id FROM personal_conversations WHERE conversation_id = 'c1'").get()?.user_id).toBe('target-user')
    database.close()
    expect(new TextDecoder().decode(await readFile(join(targetRoot, 'data/users/target-user/library/d1.md')))).toBe('notes')
    expect((await target.profiles.load('target-user')).stats.total_sessions).toBe(5)
    sessions.close(); personal.close()
  })

  test('is idempotent and never overwrites another user on a primary-key collision', async () => {
    const sourceRoot = await root(); const source = service(sourceRoot); const sourceSessions = new BunInterviewSessionRepository(source.db); sourceSessions.initialize()
    await sourceSessions.create({ sessionId: 'same-id', userId: 'source-user', mode: 'resume' })
    const exported = await source.value.exportPersonal(context('source-user'), false)
    const targetRoot = await root(); const target = service(targetRoot); const targetSessions = new BunInterviewSessionRepository(target.db); targetSessions.initialize()
    await targetSessions.create({ sessionId: 'same-id', userId: 'other-user', mode: 'recording' })
    const first = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'overwrite', overwriteFiles: false })
    const second = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'overwrite', overwriteFiles: true })
    expect(first).toMatchObject({ db_inserted: 0, db_skipped: 1 })
    expect(second).toMatchObject({ db_inserted: 0, db_skipped: 1 })
    expect((await targetSessions.get('same-id', 'other-user'))?.mode).toBe('recording')
    sourceSessions.close(); targetSessions.close()
  })

  test('rejects full-system archives at the personal import endpoint', async () => {
    const targetRoot = await root(); const target = service(targetRoot)
    const bytes = await new TarGzipArchiveCodec().pack({ manifest: { schema_version: 2, exported_at: '', user_id: null, backup_kind: 'system', includes_sensitive_credentials: true }, files: new Map() })
    await expect(target.value.importPersonal(context('target-user'), 'full.tar.gz', bytes, { dbStrategy: 'skip', overwriteFiles: false })).rejects.toThrow('单账户备份')
  })
})
