import { access, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { DocumentTextExtractor, KnowledgeFile, KnowledgeStore, Topic, TopicMap } from '@techspar/core'
import presetTopicsJson from '../assets/preset-topics.json' with { type: 'json' }
import { extractOfficeXmlEntries } from './office-archive.ts'
import { atomicWriteJson } from './provider-settings-repository.ts'

type PresetTopic = Topic & { key: string; readme: string }
const presetTopics = presetTopicsJson as PresetTopic[]

function safeSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) throw new Error(`Invalid ${label}`)
  return value
}

function pathWithin(root: string, ...parts: string[]): string {
  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, ...parts)
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) throw new Error('path escapes its allowed directory')
  return candidate
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${crypto.randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export class FileKnowledgeStore implements KnowledgeStore {
  constructor(private readonly dataDir: string) {}

  private userDir(userId: string): string {
    return pathWithin(join(this.dataDir, 'users'), safeSegment(userId, 'user id'))
  }

  private topicDir(userId: string, directory: string): string {
    return pathWithin(join(this.userDir(userId), 'knowledge'), safeSegment(directory, 'topic directory'))
  }

  private async seedPresets(userId: string): Promise<void> {
    const userDir = this.userDir(userId)
    const topicsPath = join(userDir, 'topics.json')
    const statePath = join(userDir, '.preset_topics_state.json')
    const topics = await this.readTopics(topicsPath)
    const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{"seeded_keys":[]}')) as { seeded_keys?: string[] }
    const seeded = new Set(state.seeded_keys || [])
    let topicsChanged = false
    let stateChanged = false
    for (const preset of presetTopics) {
      let topic = topics[preset.key]
      if (!seeded.has(preset.key) && !topic) {
        topic = { name: preset.name, icon: preset.icon, dir: preset.dir }
        topics[preset.key] = topic
        topicsChanged = true
      }
      if (!seeded.has(preset.key)) {
        const effective = topic || preset
        const directory = this.topicDir(userId, effective.dir)
        await mkdir(directory, { recursive: true })
        const readme = join(directory, 'README.md')
        const current = (await readFile(readme, 'utf8').catch(() => '')).trim()
        if (!current || current === `# ${effective.name}`) await writeFile(readme, preset.readme, 'utf8')
        seeded.add(preset.key)
        stateChanged = true
      }
    }
    if (topicsChanged) await atomicWriteJson(topicsPath, topics)
    if (stateChanged) await atomicWriteJson(statePath, { seeded_keys: [...seeded].sort() })
  }

  private async readTopics(path: string): Promise<TopicMap> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as TopicMap
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return {}
      throw error
    }
  }

  async loadTopics(userId: string): Promise<TopicMap> {
    await this.seedPresets(userId)
    return this.readTopics(join(this.userDir(userId), 'topics.json'))
  }

  saveTopics(userId: string, topics: TopicMap): Promise<void> {
    return atomicWriteJson(join(this.userDir(userId), 'topics.json'), topics)
  }

  async ensureTopic(userId: string, directory: string, title: string): Promise<void> {
    const root = this.topicDir(userId, directory)
    await mkdir(root, { recursive: true })
    const readme = join(root, 'README.md')
    if (!(await exists(readme))) await writeFile(readme, `# ${title}\n`, 'utf8')
  }

  async listCore(userId: string, directory: string): Promise<KnowledgeFile[]> {
    const root = this.topicDir(userId, directory)
    if (!(await exists(root))) return []
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
    return Promise.all(entries.map(async (entry) => ({ filename: entry.name, content: await readFile(join(root, entry.name), 'utf8') })))
  }

  async writeCore(
    userId: string,
    directory: string,
    filename: string,
    content: string,
    mode: 'create' | 'replace' | 'upsert',
  ): Promise<void> {
    const root = this.topicDir(userId, directory)
    await mkdir(root, { recursive: true })
    const path = pathWithin(root, safeSegment(filename, 'knowledge filename'))
    if (mode === 'create') {
      const handle = await open(path, 'wx')
      try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
      return
    }
    if (mode === 'replace') await access(path)
    await atomicWriteText(path, content)
  }

  async deleteCore(userId: string, directory: string, filename: string): Promise<boolean> {
    const path = pathWithin(this.topicDir(userId, directory), safeSegment(filename, 'knowledge filename'))
    try {
      await rm(path)
      return true
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false
      throw error
    }
  }

  async readHighFrequency(userId: string, topic: string): Promise<string> {
    const path = pathWithin(join(this.userDir(userId), 'high_freq'), `${safeSegment(topic, 'topic')}.md`)
    return readFile(path, 'utf8').catch((error) => {
      if ((error as { code?: string }).code === 'ENOENT') return ''
      throw error
    })
  }

  async writeHighFrequency(userId: string, topic: string, content: string): Promise<void> {
    const path = pathWithin(join(this.userDir(userId), 'high_freq'), `${safeSegment(topic, 'topic')}.md`)
    await atomicWriteText(path, content)
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

export class PortableDocumentTextExtractor implements DocumentTextExtractor {
  async extract(filename: string, bytes: Uint8Array): Promise<string> {
    const suffix = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    if (suffix === '.md' || suffix === '.markdown' || suffix === '.txt') return new TextDecoder().decode(bytes)
    if (suffix === '.docx') {
      const files = extractOfficeXmlEntries(bytes, 'docx')
      const xml = files['word/document.xml']
      if (!xml) return ''
      const content = new TextDecoder().decode(xml)
      return decodeXmlEntities(
        content
          .replace(/<w:tab\s*\/>/g, '\t')
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, ''),
      )
    }
    if (suffix === '.pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const document = await getDocument({ data: bytes }).promise
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const text = await page.getTextContent()
        pages.push(text.items.map((item) => 'str' in item ? item.str : '').join(' '))
      }
      return pages.join('\n')
    }
    return ''
  }
}
