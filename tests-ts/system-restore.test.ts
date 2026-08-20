import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { assertSafeSystemDataDir, restoreSystemArchive, TarGzipArchiveCodec, type SystemRestoreOperations } from '@techspar/platform'

const roots: string[] = []
const REPOSITORY_ROOT = resolve(import.meta.dir, '..')
async function testRoot(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'techspar-system-restore-')); roots.push(value); return value }
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })

async function sqliteBytes(root: string, value = 'restored'): Promise<Uint8Array> {
  const path = join(root, `${crypto.randomUUID()}.db`); const database = new Database(path, { create: true })
  database.exec('CREATE TABLE restore_marker (value TEXT NOT NULL)')
  database.query('INSERT INTO restore_marker (value) VALUES (?)').run(value)
  database.close()
  return readFile(path)
}

function manifest(input: { kind?: 'personal' | 'system'; userId?: string | null; schemaVersion?: number } = {}) {
  return {
    schema_version: input.schemaVersion ?? 2,
    exported_at: '2026-08-20T00:00:00',
    user_id: input.userId === undefined ? null : input.userId,
    backup_kind: input.kind ?? 'system',
    includes_sensitive_credentials: true,
    source: 'data',
  }
}

async function archiveFile(root: string, database: Uint8Array, options: { kind?: 'personal' | 'system'; userId?: string | null; schemaVersion?: number; files?: Map<string, Uint8Array>; name?: string } = {}): Promise<string> {
  const bytes = await new TarGzipArchiveCodec().pack({ manifest: manifest(options), database, files: options.files || new Map() })
  const path = join(root, options.name || `${crypto.randomUUID()}.tar.gz`); await writeFile(path, bytes); return path
}

async function target(root: string) {
  const projectRoot = join(root, 'project'); await mkdir(projectRoot)
  return { projectRoot, dataDir: join(projectRoot, 'data') }
}

describe('offline system archive restore', () => {
  test('defaults to preflight and leaves the current data directory unchanged', async () => {
    const root = await testRoot(); const paths = await target(root); await mkdir(paths.dataDir); await writeFile(join(paths.dataDir, 'old.txt'), 'old data')
    const archivePath = await archiveFile(root, await sqliteBytes(root), { files: new Map([['data/users/user-a/note.txt', Buffer.from('new data')]]) })

    const result = await restoreSystemArchive({ archivePath, dataDir: paths.dataDir, projectRoot: paths.projectRoot })

    expect(result).toMatchObject({ mode: 'preflight', schemaVersion: 2, fileCount: 1, backupDir: null })
    expect(result.dataDir).toBe(join(await realpath(paths.projectRoot), 'data'))
    expect(await readFile(join(paths.dataDir, 'old.txt'), 'utf8')).toBe('old data')
    expect(await readdir(paths.projectRoot)).toEqual(['data'])
  })

  test('exposes the package CLI as a dry-run unless --confirm is present', async () => {
    const root = await testRoot(); const paths = await target(root); await mkdir(paths.dataDir); await writeFile(join(paths.dataDir, 'old.txt'), 'old data')
    const archivePath = await archiveFile(root, await sqliteBytes(root))
    const child = Bun.spawn({ cmd: [process.execPath, 'run', 'restore:system', '--', `--archive=${archivePath}`, `--data-dir=${paths.dataDir}`], cwd: REPOSITORY_ROOT, stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])

    expect(exitCode).toBe(0)
    expect(stderr).not.toContain('系统归档解析失败')
    expect(stdout).toContain('预检通过；未修改任何数据')
    expect(await readFile(join(paths.dataDir, 'old.txt'), 'utf8')).toBe('old data')
  })

  test('restores only after confirmation and keeps the old directory recoverable', async () => {
    const root = await testRoot(); const paths = await target(root); await mkdir(paths.dataDir); await writeFile(join(paths.dataDir, 'old.txt'), 'old data')
    const archivePath = await archiveFile(root, await sqliteBytes(root, 'new database'), { files: new Map([['data/users/user-a/note.txt', Buffer.from('new file')]]) })

    const result = await restoreSystemArchive({ archivePath, dataDir: paths.dataDir, projectRoot: paths.projectRoot, confirm: true, now: () => new Date('2026-08-20T12:34:56Z') })

    expect(result.mode).toBe('restored')
    expect(result.backupDir).toContain('data.before-system-restore-20260820-123456Z-')
    expect(await readFile(join(paths.dataDir, 'users/user-a/note.txt'), 'utf8')).toBe('new file')
    const restored = new Database(join(paths.dataDir, 'interviews.db'), { readonly: true })
    expect(restored.query<{ value: string }, []>('SELECT value FROM restore_marker').get()?.value).toBe('new database'); restored.close()
    expect(await readFile(join(result.backupDir!, 'old.txt'), 'utf8')).toBe('old data')

    const restoredCopy = join(paths.projectRoot, 'restored-copy'); await rename(paths.dataDir, restoredCopy); await rename(result.backupDir!, paths.dataDir)
    expect(await readFile(join(paths.dataDir, 'old.txt'), 'utf8')).toBe('old data')
  })

  test('rejects personal, rebound, and unsupported-schema archives', async () => {
    const root = await testRoot(); const paths = await target(root); const database = await sqliteBytes(root)
    const personal = await archiveFile(root, database, { kind: 'personal', userId: 'user-a', name: 'personal.tar.gz' })
    const rebound = await archiveFile(root, database, { kind: 'system', userId: 'user-a', name: 'rebound.tar.gz' })
    const oldSchema = await archiveFile(root, database, { schemaVersion: 1, name: 'old-schema.tar.gz' })

    await expect(restoreSystemArchive({ archivePath: personal, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('backup_kind=system')
    await expect(restoreSystemArchive({ archivePath: rebound, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('user_id=null')
    await expect(restoreSystemArchive({ archivePath: oldSchema, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('schema_version')
  })

  test('rejects a damaged SQLite database during PRAGMA integrity_check', async () => {
    const root = await testRoot(); const paths = await target(root); await mkdir(paths.dataDir); await writeFile(join(paths.dataDir, 'old.txt'), 'still here')
    const valid = await sqliteBytes(root); const truncated = valid.slice(0, Math.floor(valid.length / 2))
    const archivePath = await archiveFile(root, truncated)

    await expect(restoreSystemArchive({ archivePath, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('integrity_check')
    expect(await readFile(join(paths.dataDir, 'old.txt'), 'utf8')).toBe('still here')
  })

  test('rejects files outside data and dangerous restore targets', async () => {
    const root = await testRoot(); const paths = await target(root); const database = await sqliteBytes(root)
    const archivePath = await archiveFile(root, database, { files: new Map([['outside.txt', Buffer.from('no')]]) })
    const sidecar = await archiveFile(root, database, { files: new Map([['data/interviews.db-wal', Buffer.from('no')]]), name: 'sidecar.tar.gz' })
    await expect(restoreSystemArchive({ archivePath, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('data/ 之外')
    await expect(restoreSystemArchive({ archivePath: sidecar, dataDir: paths.dataDir, projectRoot: paths.projectRoot })).rejects.toThrow('旁路文件')

    expect(() => assertSafeSystemDataDir('/', paths.projectRoot)).toThrow('危险')
    expect(() => assertSafeSystemDataDir(homedir(), paths.projectRoot)).toThrow('危险')
    expect(() => assertSafeSystemDataDir(paths.projectRoot, paths.projectRoot)).toThrow('危险')
    expect(() => assertSafeSystemDataDir(join(paths.projectRoot, 'packages'), paths.projectRoot)).toThrow('项目目录')
    expect(assertSafeSystemDataDir(paths.dataDir, paths.projectRoot)).toBe(paths.dataDir)

    const broad = join(root, 'unrelated-downloads'); await mkdir(broad)
    await expect(restoreSystemArchive({ archivePath: sidecar, dataDir: broad, projectRoot: paths.projectRoot })).rejects.toThrow('不像 TechSpar')
  })

  test('rolls the old directory back if activation rename fails', async () => {
    const root = await testRoot(); const paths = await target(root); await mkdir(paths.dataDir); await writeFile(join(paths.dataDir, 'old.txt'), 'rollback me')
    const archivePath = await archiveFile(root, await sqliteBytes(root))
    let blocked = false
    const operations: SystemRestoreOperations = {
      async rename(from, to) {
        if (!blocked && basename(from).startsWith('.data.restore-') && basename(to) === 'data') { blocked = true; throw new Error('simulated activation failure') }
        await rename(from, to)
      },
    }

    await expect(restoreSystemArchive({ archivePath, dataDir: paths.dataDir, projectRoot: paths.projectRoot, confirm: true }, operations)).rejects.toThrow('simulated activation failure')
    expect(await readFile(join(paths.dataDir, 'old.txt'), 'utf8')).toBe('rollback me')
    expect((await readdir(paths.projectRoot)).filter((name) => name.includes('restore'))).toEqual([])
  })
})
