import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  InterviewService,
  PersistentTaskQueue,
  ResumeInterviewEngine,
  type CandidateProfilePort,
  type ChatMessage,
  type InterviewDependencies,
  type KnowledgeStore,
  type PersistentTaskDispatcher,
  type RequestContext,
  type TaskRecord,
  type TextGenerationUseCases,
} from '@techspar/core'
import { BunInterviewSessionRepository, BunResumeInterviewStateRepository, BunTaskRepository } from '@techspar/db'

const directories: string[] = []
async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'techspar-interview-'))
  directories.push(directory)
  return join(directory, 'techspar.db')
}
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }) })

const context: RequestContext = { requestId: 'test', userId: 'user-a', signal: new AbortController().signal }

class FakeAi implements TextGenerationUseCases {
  calls: ChatMessage[][] = []
  constructor(private readonly replies: string[]) {}
  async complete(_context: RequestContext, messages: readonly ChatMessage[]): Promise<string> {
    this.calls.push([...messages])
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error('Unexpected LLM call')
    return reply
  }
  async *stream(_context: RequestContext, messages: readonly ChatMessage[]): AsyncIterable<string> {
    const reply = await this.complete(_context, messages)
    for (const chunk of reply.match(/.{1,7}/gs) || []) yield chunk
  }
}

const profile: CandidateProfilePort = {
  async summary() { return '后端经验较强' },
  async targetRole() { return '' },
  async updateTargetRole() {},
}

describe('interview persistence', () => {
  test('keeps session JSON compatible and user-scoped', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path)
    sessions.initialize()
    await sessions.create({ sessionId: 's1', userId: 'user-a', mode: 'topic_drill', topic: 'python', questions: [{ id: 1, question: '为什么需要 GIL？' }], meta: { source: 'test' } })
    await sessions.saveAnswers('s1', 'user-a', [{ question_id: 1, answer: '保护解释器内部状态' }])
    expect((await sessions.get('s1', 'user-a'))?.transcript.map((message) => message.role)).toEqual(['assistant', 'user'])
    expect(await sessions.get('s1', 'user-b')).toBeUndefined()
    expect(await sessions.delete('s1', 'user-b')).toBeFalse()
    sessions.close()
  })

  test('hides untouched sessions but keeps drafts resumable', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path)
    sessions.initialize()
    await sessions.create({ sessionId: 'empty', userId: 'user-a', mode: 'topic_drill', topic: 'ts' })
    await sessions.create({ sessionId: 'draft', userId: 'user-a', mode: 'topic_drill', topic: 'ts', questions: [{ id: 1, question: '解释结构类型' }] })
    await sessions.saveAnswers('draft', 'user-a', [{ question_id: 1, answer: '按成员兼容' }])
    const history = await sessions.list({ userId: 'user-a', limit: 20, offset: 0 })
    expect(history.items.map((item) => item.session_id)).toEqual(['draft'])
    sessions.close()
  })

  test('persists and recovers pending jobs after a new queue starts', async () => {
    const path = await databasePath()
    const first = new BunTaskRepository(path)
    first.initialize()
    await first.upsert({ taskId: 'review-1', userId: 'user-a', type: 'review', payload: { session_id: 'review-1' } })
    first.close()

    const reopened = new BunTaskRepository(path)
    reopened.initialize()
    const queue = new PersistentTaskQueue(reopened)
    queue.register('review', async () => ({ restored: true }))
    await queue.start()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await reopened.get('review-1', 'user-a'))?.status === 'done') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(await reopened.get('review-1', 'user-a')).toMatchObject({ status: 'done', attempts: 1, result: { restored: true } })
    reopened.close()
  })
})

describe('resume interview state machine', () => {
  test('injects target role and JD and persists them in state', async () => {
    const path = await databasePath()
    const states = new BunResumeInterviewStateRepository(path)
    states.initialize()
    const ai = new FakeAi(['欢迎，请做自我介绍。'])
    const engine = new ResumeInterviewEngine(ai, states, profile)
    const started = await engine.start(context, { sessionId: 'resume-1', targetRole: '后端开发工程师', jobDescription: '负责高并发 API，要求 PostgreSQL 和系统设计。', resumeContext: '做过订单服务' })
    await states.save('resume-1', 'user-a', started.state)
    const prompt = ai.calls[0]![0]!.content
    expect(prompt).toContain('后端开发工程师')
    expect(prompt).toContain('负责高并发 API')
    expect(await states.load('resume-1', 'user-a')).toMatchObject({ target_role: '后端开发工程师', job_description: '负责高并发 API，要求 PostgreSQL 和系统设计。' })
    states.close()
  })

  test('finishes reverse QA without another model call', async () => {
    const path = await databasePath()
    const states = new BunResumeInterviewStateRepository(path)
    states.initialize()
    const ai = new FakeAi([])
    const engine = new ResumeInterviewEngine(ai, states, profile)
    const state = {
      messages: [], phase: 'reverse_qa' as const, target_role: '后端', job_description: '', resume_context: '', questions_asked: [], phase_question_count: 2, is_finished: false, last_eval: {}, eval_history: [],
    }
    const result = await engine.turn(context, 'resume-end', state, '没有问题了，谢谢')
    expect(result).toEqual({ message: '', isFinished: true })
    expect(ai.calls).toHaveLength(0)
    expect((await states.load('resume-end', 'user-a'))?.is_finished).toBeTrue()
    states.close()
  })
})

describe('interview application service', () => {
  test('starts resume sessions with durable state and metadata', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const ai = new FakeAi(['欢迎，请做自我介绍。'])
    const dispatched: TaskRecord[] = []
    const tasks: PersistentTaskDispatcher = {
      async enqueue(input) { const task = { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending' as const, payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' }; dispatched.push(task); return task },
      async get() { return undefined },
    }
    const knowledgeStore: KnowledgeStore = {
      async loadTopics() { return {} }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {},
    }
    const deps: InterviewDependencies = {
      sessions, states, tasks, ids: { next: () => 'resume-2' }, ai,
      resume: { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '候选人做过订单服务' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } },
      knowledge: { async context() { return '' } }, knowledgeStore,
      settings: { async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }, async saveProvider() {}, async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {} },
      profile,
    }
    const service = new InterviewService(deps)
    const result = await service.start(context, { mode: 'resume', target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' })
    expect(result).toMatchObject({ session_id: 'resume-2', target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' })
    expect(await sessions.get('resume-2', 'user-a')).toMatchObject({ meta: { target_role: 'AI 应用开发工程师', job_description: '负责 RAG 应用开发' } })
    expect(await states.load('resume-2', 'user-a')).toMatchObject({ resume_context: '候选人做过订单服务' })
    sessions.close(); states.close()
  })
})
