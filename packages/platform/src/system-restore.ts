import { Database } from 'bun:sqlite'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { DATA_ARCHIVE_SCHEMA_VERSION, type ArchiveContents } from '@techspar/core'
import { TarGzipArchiveCodec } from './data-archive.ts'

const PROJECT_ROOT = resolve(import.meta.dir, '../../..')
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0')
const PROTECTED_PROJECT_PATHS = new Set(['.git', 'apps', 'packages', 'frontend', 'scripts', 'tests-ts', 'docs', 'node_modules'])

export type SystemRestoreOptions = {
  archivePath: string
  dataDir: string
  confirm?: boolean
  projectRoot?: string
  now?: () => Date
}

export type SystemRestoreOperations = {
  rename(from: string, to: string): Promise<void>
}

export type SystemRestoreResult = {
  mode: 'preflight' | 'restored'
  archivePath: string
  dataDir: string
  schemaVersion: number
  databaseBytes: number
  fileCount: number
  fileBytes: number
  directoryCount: number
  backupDir: string | null
}

type RestoreFile = { relativePath: string; bytes: Uint8Array }
type RestorePlan = { archive: ArchiveContents; database: Uint8Array; files: RestoreFile[]; directories: string[]; archivePath: string }

const defaultOperations: SystemRestoreOperations = { rename }

function existsError(error: unknown, code: string): boolean { return (error as NodeJS.ErrnoException).code === code }
async function statIfPresent(path: string) { try { return await lstat(path) } catch (error) { if (existsError(error, 'ENOENT')) return undefined; throw error } }
function isSameOrAncestor(candidate: string, descendant: string): boolean {
  const value = relative(candidate, descendant)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}
function pathDepth(path: string): number { return relative(parse(path).root, path).split(sep).filter(Boolean).length }

export function assertSafeSystemDataDir(dataDir: string, projectRoot = PROJECT_ROOT): string {
  const target = resolve(dataDir); const project = resolve(projectRoot)
  if (target === parse(target).root || pathDepth(target) < 2) throw new Error(`拒绝危险 data-dir: ${target}`)
  for (const protectedRoot of [resolve(homedir()), resolve(tmpdir()), project]) {
    if (isSameOrAncestor(target, protectedRoot)) throw new Error(`拒绝危险 data-dir: ${target}`)
  }
  const withinProject = relative(project, target)
  if (withinProject && !withinProject.startsWith(`..${sep}`) && withinProject !== '..' && !isAbsolute(withinProject)) {
    const first = withinProject.split(sep)[0]
    if (first && PROTECTED_PROJECT_PATHS.has(first)) throw new Error(`拒绝覆盖项目目录: ${target}`)
  }
  return target
}

async function resolveRestoreTarget(dataDir: string, projectRoot: string): Promise<string> {
  const requested = assertSafeSystemDataDir(dataDir, projectRoot)
  const requestedStat = await statIfPresent(requested)
  if (requestedStat?.isSymbolicLink()) throw new Error(`data-dir 不能是符号链接: ${requested}`)
  const parent = dirname(requested); const parentStat = await statIfPresent(parent)
  if (!parentStat?.isDirectory()) throw new Error(`data-dir 的父目录不存在或不是目录: ${parent}`)
  const target = assertSafeSystemDataDir(join(await realpath(parent), basename(requested)), projectRoot)
  const targetStat = await statIfPresent(target)
  if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) throw new Error(`data-dir 必须是普通目录或尚不存在: ${target}`)
  if (targetStat && basename(target).toLowerCase() !== 'data') {
    const database = await statIfPresent(join(target, 'interviews.db')); const users = await statIfPresent(join(target, 'users'))
    if (!database?.isFile() && !users?.isDirectory()) throw new Error(`现有目录不像 TechSpar data-dir，拒绝覆盖: ${target}`)
  }
  return target
}

function archiveRelativePath(path: string): string {
  if (!path.startsWith('data/')) throw new Error(`系统归档包含 data/ 之外的文件: ${path}`)
  const value = path.slice('data/'.length); const parts = value.split('/')
  if (!value || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) throw new Error(`系统归档包含不安全路径: ${path}`)
  if (value === 'interviews.db' || value.startsWith('interviews.db/')) throw new Error(`系统归档路径与 data/interviews.db 冲突: ${path}`)
  if (['interviews.db-wal', 'interviews.db-shm', 'interviews.db-journal'].includes(value)) throw new Error(`系统归档不允许携带 SQLite 旁路文件: ${path}`)
  return value
}

function validateManifest(archive: ArchiveContents): void {
  const manifest = archive.manifest
  if (!manifest) throw new Error('系统归档缺少 manifest.json')
  if (manifest.backup_kind !== 'system' || manifest.user_id !== null) throw new Error('只允许恢复 backup_kind=system 且 user_id=null 的系统归档')
  if (manifest.schema_version !== DATA_ARCHIVE_SCHEMA_VERSION) throw new Error(`不支持的系统归档 schema_version: ${String(manifest.schema_version)}（当前仅支持 ${DATA_ARCHIVE_SCHEMA_VERSION}）`)
  if (manifest.includes_sensitive_credentials !== true || typeof manifest.exported_at !== 'string' || !manifest.exported_at.trim()) throw new Error('系统归档 manifest 字段不完整')
}

function validateSqliteHeader(bytes: Uint8Array): void {
  if (bytes.length < 100 || SQLITE_HEADER.some((value, index) => bytes[index] !== value)) throw new Error('系统归档中的 data/interviews.db 不是有效的 SQLite 数据库')
}

async function assertSqliteIntegrity(path: string): Promise<void> {
  let database: Database | undefined
  try {
    database = new Database(path, { readonly: true })
    const rows = database.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all()
    if (rows.length !== 1 || rows[0]?.integrity_check.toLowerCase() !== 'ok') throw new Error(rows.map((row) => row.integrity_check).slice(0, 5).join('; ') || 'unknown integrity error')
  } catch (error) {
    throw new Error(`SQLite PRAGMA integrity_check 失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally { database?.close() }
}

async function loadRestorePlan(archivePath: string): Promise<RestorePlan> {
  let resolvedArchive: string; let archive: ArchiveContents
  try {
    resolvedArchive = await realpath(resolve(archivePath))
    if (!(await lstat(resolvedArchive)).isFile()) throw new Error('archive 不是普通文件')
    archive = await new TarGzipArchiveCodec().unpack(await readFile(resolvedArchive))
  }
  catch (error) { throw new Error(`系统归档解析失败: ${error instanceof Error ? error.message : String(error)}`) }
  validateManifest(archive)
  if (!archive.database) throw new Error('系统归档缺少 data/interviews.db')
  validateSqliteHeader(archive.database)
  const files = [...archive.files].map(([path, bytes]) => ({ relativePath: archiveRelativePath(path), bytes }))
  const directories = (archive.directories || []).map((path) => path === 'data' ? '' : archiveRelativePath(path)).filter(Boolean)
  const paths = new Set(files.map((file) => file.relativePath))
  for (const path of paths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join('/')
      if (paths.has(ancestor)) throw new Error(`系统归档文件路径互相冲突: data/${ancestor} 与 data/${path}`)
    }
  }
  for (const directory of directories) {
    const parts = directory.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const ancestor = parts.slice(0, index).join('/')
      if (paths.has(ancestor)) throw new Error(`系统归档文件与目录路径冲突: data/${ancestor} 与 data/${directory}`)
    }
  }
  return { archive, database: archive.database, files, directories, archivePath: resolvedArchive }
}

function inside(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split('/')); const value = relative(root, target)
  if (!value || value.startsWith(`..${sep}`) || value === '..' || isAbsolute(value)) throw new Error(`系统归档包含不安全路径: ${relativePath}`)
  return target
}

async function checkDatabaseBytes(bytes: Uint8Array): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-system-restore-check-')); const path = join(directory, 'interviews.db')
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); await assertSqliteIntegrity(path) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

async function buildStaging(parent: string, name: string, plan: RestorePlan): Promise<string> {
  const staging = await mkdtemp(join(parent, `.${name}.restore-`))
  try {
    await chmod(staging, 0o700)
    await writeFile(join(staging, 'interviews.db'), plan.database, { flag: 'wx', mode: 0o600 })
    for (const directory of plan.directories.sort((left, right) => left.localeCompare(right))) await mkdir(inside(staging, directory), { recursive: true, mode: 0o700 })
    for (const file of plan.files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
      const target = inside(staging, file.relativePath)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, file.bytes, { flag: 'wx', mode: 0o600 })
    }
    await assertSqliteIntegrity(join(staging, 'interviews.db'))
    return staging
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

function backupName(dataDir: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z')
  return join(dirname(dataDir), `${basename(dataDir)}.before-system-restore-${timestamp}-${crypto.randomUUID().slice(0, 8)}`)
}

export async function restoreSystemArchive(options: SystemRestoreOptions, operations: SystemRestoreOperations = defaultOperations): Promise<SystemRestoreResult> {
  const projectRoot = await realpath(resolve(options.projectRoot || PROJECT_ROOT))
  const dataDir = await resolveRestoreTarget(options.dataDir, projectRoot)
  const plan = await loadRestorePlan(options.archivePath)
  if (isSameOrAncestor(dataDir, plan.archivePath)) throw new Error('系统归档文件必须放在待恢复 data-dir 之外')
  const result = {
    archivePath: plan.archivePath,
    dataDir,
    schemaVersion: plan.archive.manifest!.schema_version,
    databaseBytes: plan.database.length,
    fileCount: plan.files.length,
    fileBytes: plan.files.reduce((total, file) => total + file.bytes.length, 0),
    directoryCount: plan.directories.length,
  }
  if (!options.confirm) {
    await checkDatabaseBytes(plan.database)
    return { mode: 'preflight', ...result, backupDir: null }
  }

  const staging = await buildStaging(dirname(dataDir), basename(dataDir), plan); let activated = false; let backupDir: string | null = null; let originalMoved = false
  try {
    const current = await statIfPresent(dataDir)
    if (current && (!current.isDirectory() || current.isSymbolicLink())) throw new Error(`data-dir 在恢复期间变成了非普通目录: ${dataDir}`)
    if (current) {
      backupDir = backupName(dataDir, (options.now || (() => new Date()))())
      await operations.rename(dataDir, backupDir); originalMoved = true
    }
    try { await operations.rename(staging, dataDir); activated = true }
    catch (activationError) {
      if (originalMoved && backupDir) {
        try { await operations.rename(backupDir, dataDir); originalMoved = false }
        catch (rollbackError) { throw new AggregateError([activationError, rollbackError], `恢复激活失败且自动回滚失败；原数据仍保留在 ${backupDir}`) }
      }
      throw activationError
    }
    return { mode: 'restored', ...result, backupDir }
  } finally { if (!activated) await rm(staging, { recursive: true, force: true }) }
}
