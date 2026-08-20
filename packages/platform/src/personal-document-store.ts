import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { PersonalDocumentExtractor, PersonalDocumentStore } from '@techspar/core'
import { PortableDocumentTextExtractor } from './knowledge-store.ts'
import { extractOfficeXmlEntries } from './office-archive.ts'

function segment(value: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) throw new Error('Invalid path segment')
  return value
}
function within(root: string, ...parts: string[]): string {
  const base = resolve(root); const path = resolve(base, ...parts)
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error('path escapes its allowed directory')
  return path
}
function decode(bytes: Uint8Array): string {
  for (const encoding of ['utf-8', 'gb18030', 'utf-16']) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes) } catch { /* next */ }
  }
  return new TextDecoder().decode(bytes)
}
function xmlText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim()
}

export class FilePersonalDocumentStore implements PersonalDocumentStore {
  constructor(private readonly dataDir: string) {}
  private directory(userId: string): string { return within(join(this.dataDir, 'users'), segment(userId), 'library') }
  async save(userId: string, storedName: string, bytes: Uint8Array): Promise<void> {
    const directory = this.directory(userId); await mkdir(directory, { recursive: true })
    const target = within(directory, segment(storedName)); const temporary = within(directory, `.${crypto.randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await rename(temporary, target) } finally { await rm(temporary, { force: true }).catch(() => undefined) }
  }
  read(userId: string, storedName: string): Promise<Uint8Array> { return readFile(within(this.directory(userId), segment(storedName))) }
  async delete(userId: string, storedName: string): Promise<void> { await rm(within(this.directory(userId), segment(storedName)), { force: true }) }
}

export class PortablePersonalDocumentExtractor implements PersonalDocumentExtractor {
  private readonly base = new PortableDocumentTextExtractor()
  async extract(filename: string, bytes: Uint8Array): Promise<string> {
    const suffix = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (['.pdf', '.docx', '.md', '.markdown', '.txt'].includes(suffix)) return this.base.extract(filename, bytes)
    if (suffix === '.pptx' || suffix === '.xlsx') {
      const files = extractOfficeXmlEntries(bytes, suffix === '.pptx' ? 'pptx' : 'xlsx')
      const names = Object.keys(files).filter((name) => suffix === '.pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(name) : name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return names.map((name) => xmlText(decode(files[name]!))).filter(Boolean).join('\n\n')
    }
    const raw = decode(bytes)
    if (suffix === '.html' || suffix === '.htm') return xmlText(raw)
    if (suffix === '.rtf') return raw.replace(/\\'[0-9a-fA-F]{2}|\\[a-zA-Z]+-?\d* ?|[{}]/g, ' ').replace(/\s+/g, ' ').trim()
    return raw
  }
}
