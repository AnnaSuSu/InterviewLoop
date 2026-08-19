import { AppError, AuthenticationError } from '../kernel/errors.ts'
import type { RequestContext } from '../kernel/context.ts'
import {
  KNOWLEDGE_IMPORT_EXTENSIONS,
  MAX_KNOWLEDGE_UPLOAD_BYTES,
  type Topic,
  type TopicMap,
} from './model.ts'
import type { KnowledgeDependencies, KnowledgeUseCases } from './ports.ts'

function fileNameOnly(value: string): string {
  return value.replaceAll('\\', '/').split('/').at(-1)?.trim() || ''
}

function extension(value: string): string {
  const index = value.lastIndexOf('.')
  return index < 0 ? '' : value.slice(index).toLowerCase()
}

function stem(value: string): string {
  const index = value.lastIndexOf('.')
  return (index < 0 ? value : value.slice(0, index)).trim()
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

export class KnowledgeService implements KnowledgeUseCases {
  constructor(private readonly deps: KnowledgeDependencies) {}

  private userId(context: RequestContext): string {
    if (!context.userId) throw new AuthenticationError()
    return context.userId
  }

  private async topic(context: RequestContext, key: string): Promise<[string, Topic]> {
    const userId = this.userId(context)
    const value = (await this.deps.store.loadTopics(userId))[key]
    if (!value) throw new AppError(`Unknown topic: ${key}`, 400)
    return [userId, value]
  }

  topics(context: RequestContext): Promise<TopicMap> {
    return this.deps.store.loadTopics(this.userId(context))
  }

  async createTopic(context: RequestContext, input: { name: string; icon?: string; key?: string }) {
    const userId = this.userId(context)
    const name = input.name.trim()
    if (!name) throw new AppError('name is required', 400)
    let key = (input.key || '').trim().replace(/[^a-zA-Z0-9_-]/g, '')
    if (!key) key = this.deps.ids.next()
    const topics = await this.deps.store.loadTopics(userId)
    if (topics[key]) throw new AppError(`Topic '${key}' already exists`, 409)
    topics[key] = { name, icon: (input.icon || '📝').trim(), dir: key }
    await this.deps.store.saveTopics(userId, topics)
    await this.deps.store.ensureTopic(userId, key, name)
    return { ok: true as const, key }
  }

  async deleteTopic(context: RequestContext, key: string) {
    const userId = this.userId(context)
    const topics = await this.deps.store.loadTopics(userId)
    if (!topics[key]) throw new AppError(`Topic '${key}' not found`, 404)
    delete topics[key]
    await this.deps.store.saveTopics(userId, topics)
    await this.deps.index.invalidateTopic(userId, key)
    return { ok: true as const }
  }

  async listCore(context: RequestContext, topic: string) {
    const [userId, meta] = await this.topic(context, topic)
    return this.deps.store.listCore(userId, meta.dir)
  }

  async createCore(context: RequestContext, topic: string, input: { filename: string; content?: string }) {
    const [userId, meta] = await this.topic(context, topic)
    const filename = input.filename.trim()
    if (!filename || !filename.endsWith('.md')) throw new AppError('Filename must end with .md', 400)
    try {
      await this.deps.store.writeCore(userId, meta.dir, filename, input.content || '', 'create')
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw new AppError(`File already exists: ${filename}`, 409)
      throw error
    }
    await this.deps.index.invalidateTopic(userId, topic)
    return { ok: true as const, filename }
  }

  async updateCore(context: RequestContext, topic: string, filename: string, content: string) {
    const [userId, meta] = await this.topic(context, topic)
    try {
      await this.deps.store.writeCore(userId, meta.dir, filename, content, 'replace')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw new AppError(`File not found: ${filename}`, 404)
      throw error
    }
    await this.deps.index.invalidateTopic(userId, topic)
    return { ok: true as const }
  }

  async deleteCore(context: RequestContext, topic: string, filename: string) {
    const [userId, meta] = await this.topic(context, topic)
    if (!(await this.deps.store.deleteCore(userId, meta.dir, filename))) throw new AppError(`File not found: ${filename}`, 404)
    await this.deps.index.invalidateTopic(userId, topic)
    return { ok: true as const }
  }

  async importCore(context: RequestContext, topic: string, filename: string, bytes: Uint8Array) {
    const [userId, meta] = await this.topic(context, topic)
    const original = fileNameOnly(filename)
    const suffix = extension(original)
    if (!KNOWLEDGE_IMPORT_EXTENSIONS.has(suffix)) {
      throw new AppError(`暂不支持 ${suffix || '无扩展名'} 文件，请使用 md / txt / pdf / docx`, 400)
    }
    if (!bytes.length) throw new AppError('文件内容为空', 400)
    if (bytes.length > MAX_KNOWLEDGE_UPLOAD_BYTES) throw new AppError('文件不能超过 20 MB', 400)
    const text = (await this.deps.extractor.extract(original, bytes)).trim()
    if (!text) throw new AppError('没有提取到文字内容；扫描版 PDF 请先 OCR 或转成文字版', 400)
    const target = `${stem(original) || '导入文档'}.md`
    try {
      await this.deps.store.writeCore(userId, meta.dir, target, text, 'create')
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw new AppError(`已存在同名文件: ${target}`, 409)
      throw error
    }
    await this.deps.index.invalidateTopic(userId, topic)
    return { ok: true as const, filename: target }
  }

  async generateCore(context: RequestContext, topic: string) {
    const [userId, meta] = await this.topic(context, topic)
    const content = (await this.deps.ai.complete(context, [
      { role: 'system', content: '你是一位资深技术面试官，擅长梳理技术领域的核心知识体系。' },
      {
        role: 'user',
        content: `请为「${meta.name}」这个技术领域生成一份核心知识梳理，作为面试出题和评分的参考依据。\n\n要求：\n- 用 Markdown 格式\n- 以 \`# ${meta.name}\` 作为标题\n- 列出该领域最核心的 8-12 个知识点，每个用二级标题\n- 每个知识点下用简洁的要点说明关键概念、原理、常见面试考点\n- 重点覆盖：核心概念、工作原理、最佳实践、常见陷阱\n- 保持简洁实用，面向面试准备场景\n- 直接输出 Markdown 内容，不要包裹在代码块中`,
      },
    ])).trim()
    await this.deps.store.writeCore(userId, meta.dir, 'README.md', content, 'upsert')
    await this.deps.index.invalidateTopic(userId, topic)
    return { ok: true as const, content }
  }

  async getHighFrequency(context: RequestContext, topic: string) {
    const [userId] = await this.topic(context, topic)
    return { content: await this.deps.store.readHighFrequency(userId, topic) }
  }

  async updateHighFrequency(context: RequestContext, topic: string, content: string) {
    const [userId] = await this.topic(context, topic)
    await this.deps.store.writeHighFrequency(userId, topic, content)
    return { ok: true as const }
  }

  async graph(context: RequestContext, topic: string) {
    return this.deps.index.graph(this.userId(context), topic)
  }
}
