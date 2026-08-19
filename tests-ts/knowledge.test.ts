import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, zipSync } from 'fflate'
import { KnowledgeService } from '@techspar/core'
import { FileKnowledgeStore, PortableDocumentTextExtractor, ShortUuidGenerator } from '@techspar/platform'

describe('knowledge import compatibility', () => {
  let root: string
  let service: KnowledgeService
  const context = { requestId: 'test', userId: 'user-a', signal: new AbortController().signal }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-knowledge-'))
    service = new KnowledgeService({
      store: new FileKnowledgeStore(join(root, 'data')),
      extractor: new PortableDocumentTextExtractor(),
      index: { async invalidateTopic() {}, async graph() { return { nodes: [], links: [] } } },
      ai: { async complete() { return '' }, async *stream() {} },
      ids: new ShortUuidGenerator(),
    })
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  async function imported(filename: string): Promise<string> {
    const topics = await service.topics(context)
    return readFile(join(root, 'data', 'users', 'user-a', 'knowledge', topics.java!.dir, filename), 'utf8')
  }

  test('keeps markdown source content', async () => {
    const content = '# GC\n\n分代收集与常见回收器对比。'
    const result = await service.importCore(context, 'java', 'GC 笔记.md', new TextEncoder().encode(content))
    expect(result.filename).toBe('GC 笔记.md')
    expect(await imported(result.filename)).toBe(content)
  })

  test('extracts docx text without an office runtime', async () => {
    const xml = "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>系统设计要点：先谈约束再谈方案。</w:t></w:r></w:p></w:body></w:document>"
    const bytes = zipSync({ 'word/document.xml': strToU8(xml) })
    const result = await service.importCore(context, 'java', '系统设计.docx', bytes)
    expect(result.filename).toBe('系统设计.md')
    expect(await imported(result.filename)).toContain('先谈约束再谈方案')
  })

  test('neutralizes traversal in upload filename', async () => {
    const result = await service.importCore(context, 'java', '../../逃逸.md', new TextEncoder().encode('内容'))
    expect(result.filename).toBe('逃逸.md')
    expect(await imported(result.filename)).toBe('内容')
  })

  test('rejects unknown topic, unsupported extension, and empty files', async () => {
    await expect(service.importCore(context, 'nope', 'a.md', new TextEncoder().encode('x'))).rejects.toThrow('Unknown topic')
    await expect(service.importCore(context, 'java', 'presentation.key', new TextEncoder().encode('x'))).rejects.toThrow('暂不支持')
    await expect(service.importCore(context, 'java', 'empty.md', new Uint8Array())).rejects.toThrow('文件内容为空')
  })

  test('rejects duplicate target names', async () => {
    await service.importCore(context, 'java', 'same.txt', new TextEncoder().encode('one'))
    await expect(service.importCore(context, 'java', 'same.docx', zipSync({ 'word/document.xml': strToU8('<w:t>two</w:t>') }))).rejects.toThrow('已存在同名文件')
  })
})
