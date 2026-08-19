import { access, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Gunzip, gzipSync } from 'fflate'
import type { ArchiveContents, ArchiveManifest, DataArchiveCodec, MigrationFileStore } from '@techspar/core'
import { voiceprintFromPortable, voiceprintToPortable } from './voiceprint-repository.ts'

const BLOCK = 512
const DEFAULT_MAX_EXPANDED_ARCHIVE_BYTES = 1024 * 1024 * 1024
const GZIP_INPUT_CHUNK_BYTES = 32 * 1024
const EXCLUDED_DIRS = new Set(['.index_cache', '__pycache__'])
const SENSITIVE_FILES = new Set(['provider.json', 'voiceprint.json'])

function text(bytes: Uint8Array, offset: number, length: number): string {
  const value = new TextDecoder().decode(bytes.slice(offset, offset + length)); return value.slice(0, value.indexOf('\0') < 0 ? undefined : value.indexOf('\0')).trim()
}
function writeText(target: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = new TextEncoder().encode(value); if (encoded.length > length) throw new Error(`tar path field is too long: ${value}`); target.set(encoded, offset)
}
function octal(value: number, length: number): string { return Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, '0').slice(-(length - 1)) + '\0' }
function splitName(path: string): { name: string; prefix: string } {
  const encoded = new TextEncoder()
  if (encoded.encode(path).length <= 100) return { name: path, prefix: '' }
  for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
    const prefix = path.slice(0, index); const name = path.slice(index + 1)
    if (encoded.encode(name).length <= 100 && encoded.encode(prefix).length <= 155) return { name, prefix }
  }
  throw new Error(`tar path is too long: ${path}`)
}
function tarEntry(path: string, content: Uint8Array): Uint8Array {
  const header = new Uint8Array(BLOCK); const names = splitName(path)
  writeText(header, 0, 100, names.name); writeText(header, 100, 8, octal(0o600, 8)); writeText(header, 108, 8, octal(0, 8)); writeText(header, 116, 8, octal(0, 8)); writeText(header, 124, 12, octal(content.length, 12)); writeText(header, 136, 12, octal(Math.floor(Date.now() / 1000), 12))
  header.fill(32, 148, 156); header[156] = '0'.charCodeAt(0); writeText(header, 257, 6, 'ustar'); writeText(header, 263, 2, '00'); if (names.prefix) writeText(header, 345, 155, names.prefix)
  const checksum = header.reduce((sum, value) => sum + value, 0); writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  const padded = Math.ceil(content.length / BLOCK) * BLOCK; const output = new Uint8Array(BLOCK + padded); output.set(header); output.set(content, BLOCK); return output
}
function concat(parts: Uint8Array[]): Uint8Array { const size = parts.reduce((total, part) => total + part.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length } return output }
function gunzipLimited(bytes: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = []; let expanded = 0
  const stream = new Gunzip((chunk) => {
    expanded += chunk.length
    if (expanded > limit) throw new Error(`archive 解压后过大（上限 ${Math.floor(limit / 1024 / 1024)} MB）`)
    if (chunk.length) chunks.push(chunk.slice())
  })
  for (let offset = 0; offset < bytes.length; offset += GZIP_INPUT_CHUNK_BYTES) stream.push(bytes.slice(offset, offset + GZIP_INPUT_CHUNK_BYTES), offset + GZIP_INPUT_CHUNK_BYTES >= bytes.length)
  return concat(chunks)
}
function validateTarChecksum(header: Uint8Array, path: string): void {
  const expected = Number.parseInt(text(header, 148, 8).replace(/\0/g, '').trim(), 8)
  const copy = header.slice(); copy.fill(32, 148, 156)
  const actual = copy.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(expected) || expected !== actual) throw new Error(`archive 条目校验失败: ${path}`)
}
function safeArchivePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '')) throw new Error(`archive 包含越界路径: ${path}`)
}

export class TarGzipArchiveCodec implements DataArchiveCodec {
  constructor(private readonly maxExpandedBytes = DEFAULT_MAX_EXPANDED_ARCHIVE_BYTES) {}

  async pack(contents: { manifest: ArchiveManifest; database?: Uint8Array; files: Map<string, Uint8Array> }): Promise<Uint8Array> {
    const entries = [tarEntry('manifest.json', new TextEncoder().encode(`${JSON.stringify(contents.manifest, null, 2)}\n`))]
    if (contents.database) entries.push(tarEntry('data/interviews.db', contents.database))
    for (const [path, bytes] of [...contents.files].sort(([left], [right]) => left.localeCompare(right))) { safeArchivePath(path); entries.push(tarEntry(path, bytes)) }
    entries.push(new Uint8Array(BLOCK * 2))
    return gzipSync(concat(entries), { level: 6 })
  }

  async unpack(bytes: Uint8Array): Promise<ArchiveContents> {
    const tar = gunzipLimited(bytes, this.maxExpandedBytes); const files = new Map<string, Uint8Array>(); const seen = new Set<string>(); let manifest: ArchiveManifest | undefined; let database: Uint8Array | undefined
    for (let offset = 0; offset + BLOCK <= tar.length;) {
      const header = tar.slice(offset, offset + BLOCK); offset += BLOCK
      if (header.every((value) => value === 0)) break
      const name = text(header, 0, 100); const prefix = text(header, 345, 155); const path = prefix ? `${prefix}/${name}` : name; safeArchivePath(path); validateTarChecksum(header, path)
      if (seen.has(path)) throw new Error(`archive 包含重复条目: ${path}`); seen.add(path)
      const type = String.fromCharCode(header[156] || 48); if (type === '1' || type === '2') throw new Error(`archive 不允许链接条目: ${path}`)
      const size = Number.parseInt(text(header, 124, 12).replace(/\0/g, '').trim() || '0', 8); const padded = Math.ceil(size / BLOCK) * BLOCK
      if (!Number.isFinite(size) || size < 0 || offset + padded > tar.length) throw new Error(`archive 条目损坏: ${path}`)
      const content = tar.slice(offset, offset + size); offset += padded
      if (type === '5') continue
      if (type !== '0' && type !== '\0') throw new Error(`archive 包含不支持的条目: ${path}`)
      if (path === 'manifest.json') { const value = JSON.parse(new TextDecoder().decode(content)) as unknown; if (value && typeof value === 'object' && !Array.isArray(value)) manifest = value as ArchiveManifest }
      else if (path === 'data/interviews.db') database = content
      else files.set(path, content)
    }
    return { ...(manifest ? { manifest } : {}), ...(database ? { database } : {}), files }
  }
}

function safeUser(value: string): string { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid user id'); return value }
function inside(root: string, relativePath: string): string {
  const base = resolve(root); const parts = relativePath.split('/'); if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('Invalid archive path')
  const path = resolve(base, ...parts); if (!path.startsWith(`${base}${sep}`)) throw new Error('path escapes its allowed directory'); return path
}
async function present(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }
async function atomicBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true }); const temporary = join(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`); const handle = await open(temporary, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}

export class FileMigrationStore implements MigrationFileStore {
  constructor(private readonly dataDir: string, private readonly voiceprintMasterKey?: string) {}
  private users(): string { return join(this.dataDir, 'users') }
  private user(userId: string): string { return inside(this.users(), safeUser(userId)) }

  private async collect(root: string, archivePrefix: string, includeSensitive: boolean): Promise<Map<string, Uint8Array>> {
    const output = new Map<string, Uint8Array>()
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
        if (entry.isSymbolicLink() || EXCLUDED_DIRS.has(entry.name)) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile() && (includeSensitive || !SENSITIVE_FILES.has(entry.name))) {
          let bytes = await readFile(path)
          if (entry.name === 'voiceprint.json' && this.voiceprintMasterKey) bytes = Buffer.from(voiceprintToPortable(bytes, this.voiceprintMasterKey))
          output.set(`${archivePrefix}/${relative(root, path).split(sep).join('/')}`, bytes)
        }
      }
    }
    await walk(root); return output
  }
  exportPersonal(userId: string, includeSensitive: boolean): Promise<Map<string, Uint8Array>> { return this.collect(this.user(userId), `data/users/${safeUser(userId)}`, includeSensitive) }
  exportSystem(): Promise<Map<string, Uint8Array>> { return this.collect(this.users(), 'data/users', true) }
  exists(userId: string, relativePath: string): Promise<boolean> { return present(inside(this.user(userId), relativePath)) }
  write(userId: string, relativePath: string, bytes: Uint8Array): Promise<void> { return atomicBytes(inside(this.user(userId), relativePath), relativePath === 'voiceprint.json' && this.voiceprintMasterKey ? voiceprintFromPortable(bytes, this.voiceprintMasterKey) : bytes) }
}
