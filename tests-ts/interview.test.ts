import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  InterviewService,
  PersistentTaskQueue,
  ProfileService,
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
import { FileCandidateProfileRepository } from '@techspar/platform'

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

function taskDispatcher(dispatched: TaskRecord[] = []): PersistentTaskDispatcher {
  return {
    async enqueue(input) {
      const task = { task_id: input.taskId, user_id: input.userId, type: input.type, status: 'pending' as const, payload: input.payload, result: null, error: null, attempts: 0, created_at: '', updated_at: '' }
      dispatched.push(task)
      return task
    },
    async get(taskId, userId) { return dispatched.find((task) => task.task_id === taskId && task.user_id === userId) },
  }
}

function emptyKnowledgeStore(topics: Awaited<ReturnType<KnowledgeStore['loadTopics']>> = {}): KnowledgeStore {
  return {
    async loadTopics() { return topics }, async saveTopics() {}, async ensureTopic() {}, async listCore() { return [] }, async writeCore() {}, async deleteCore() { return false }, async readHighFrequency() { return '' }, async writeHighFrequency() {},
  }
}

function interviewDependencies(input: {
  sessions: InterviewDependencies['sessions']
  states: InterviewDependencies['states']
  ai: TextGenerationUseCases
  tasks?: PersistentTaskDispatcher
  knowledgeStore?: KnowledgeStore
  candidateProfile?: CandidateProfilePort
}): InterviewDependencies {
  return {
    sessions: input.sessions,
    states: input.states,
    tasks: input.tasks || taskDispatcher(),
    ids: { next: () => 'generated-session' },
    ai: input.ai,
    resume: { async status() { return { has_resume: false } }, async file() { throw new Error() }, async upload() { throw new Error() }, async delete() { throw new Error() }, async text() { return '' }, async parse() { throw new Error() }, async transcribe() { throw new Error() } },
    knowledge: { async context() { return '' } },
    knowledgeStore: input.knowledgeStore || emptyKnowledgeStore(),
    settings: { async loadProvider() { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }, async saveProvider() {}, async loadTraining() { return { num_questions: 10, divergence: 3 } }, async saveTraining() {}, async loadLastReindexAt() { return '' }, async saveLastReindexAt() {}, async loadSystem() { return undefined }, async saveSystem() {} },
    profile: input.candidateProfile || profile,
  }
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

  test('keeps sparse batch answers attached to their question for current and recovered review tasks', async () => {
    const path = await databasePath()
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const questions = [
      { id: 1, question: '第一题' },
      { id: 2, question: '第二题' },
      { id: 3, question: '第三题' },
    ]
    const evaluation = JSON.stringify({ scores: [{ question_id: 1, score: 8 }, { question_id: 3, score: 7 }], overall: { avg_score: 7.5, summary: '完成' } })
    const ai = new FakeAi([evaluation, evaluation])
    const dispatched: TaskRecord[] = []
    const service = new InterviewService(interviewDependencies({
      sessions, states, ai, tasks: taskDispatcher(dispatched),
      knowledgeStore: emptyKnowledgeStore({ typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } }),
    }))

    await sessions.create({ sessionId: 'batch-current', userId: 'user-a', mode: 'jd_prep', questions, meta: { preview: { position: '后端工程师' } } })
    const sparseAnswers = [{ question_id: 1, answer: '第一题答案' }, { question_id: 3, answer: '第三题答案' }]
    await service.end(context, 'batch-current', sparseAnswers)
    expect(dispatched[0]?.payload.answers_override).toEqual(sparseAnswers)
    await service.runReviewTask(dispatched[0]!)
    expect(ai.calls[0]![1]!.content).toContain('**题目**: 第二题\n**回答**: 未作答')
    expect(ai.calls[0]![1]!.content).toContain('**题目**: 第三题\n**回答**: 第三题答案')

    await sessions.create({ sessionId: 'batch-recovered', userId: 'user-a', mode: 'topic_drill', topic: 'typescript', questions })
    await sessions.saveAnswers('batch-recovered', 'user-a', sparseAnswers)
    await sessions.updateStatus('batch-recovered', 'user-a', 'reviewing')
    await service.runReviewTask({ task_id: 'batch-recovered', user_id: 'user-a', type: 'drill_review', status: 'running', payload: { session_id: 'batch-recovered' }, result: null, error: null, attempts: 1, created_at: '', updated_at: '' })
    expect(ai.calls[1]![1]!.content).toContain('**题目**: 第二题\n**回答**: 未作答')
    expect(ai.calls[1]![1]!.content).toContain('**题目**: 第三题\n**回答**: 第三题答案')
    sessions.close(); states.close()
  })

  test('persists resume extraction scores in the session and profile history', async () => {
    const path = await databasePath()
    const root = join(path, '..')
    const sessions = new BunInterviewSessionRepository(path); sessions.initialize()
    const states = new BunResumeInterviewStateRepository(path); states.initialize()
    const dimensions = { technical_depth: 8, project_articulation: 7, communication: 6.5, problem_solving: 7.5 }
    const ai = new FakeAi([
      '# 简历面试复盘\n整体表现稳定。',
      JSON.stringify({ session_summary: '表现稳定', weak_points: [], strong_points: [], behavior_signals: [], topic_mastery: {}, avg_score: 7.3, dimension_scores: dimensions }),
    ])
    const tasks = taskDispatcher()
    const knowledgeStore = emptyKnowledgeStore()
    const resume = interviewDependencies({ sessions, states, ai }).resume
    const repository = new FileCandidateProfileRepository(root)
    const candidateProfile = new ProfileService({ repository, sessions, tasks, ai, resume, knowledgeStore })
    const service = new InterviewService(interviewDependencies({ sessions, states, ai, tasks, knowledgeStore, candidateProfile }))

    await sessions.create({ sessionId: 'resume-metrics', userId: 'user-a', mode: 'resume', meta: { target_role: '后端工程师' } })
    await states.save('resume-metrics', 'user-a', {
      messages: [{ role: 'assistant', content: '请介绍服务架构' }, { role: 'user', content: '我使用分层架构并做了压测' }],
      phase: 'reverse_qa', target_role: '后端工程师', job_description: '', resume_context: '负责过订单服务', questions_asked: ['请介绍服务架构'], phase_question_count: 2, is_finished: true,
      last_eval: { score: 7 }, eval_history: [{ phase: 'technical', score: 7, brief: '技术基础稳定' }],
    })
    await service.runReviewTask({ task_id: 'resume-metrics', user_id: 'user-a', type: 'resume_review', status: 'running', payload: { session_id: 'resume-metrics' }, result: null, error: null, attempts: 1, created_at: '', updated_at: '' })

    expect(ai.calls[1]![1]!.content).toContain('dimension_scores')
    expect(await sessions.get('resume-metrics', 'user-a')).toMatchObject({ overall: { avg_score: 7.3, dimension_scores: dimensions } })
    expect((await repository.load('user-a')).stats.score_history.at(-1)).toMatchObject({ mode: 'resume', avg_score: 7.3, dimension_scores: dimensions })
    sessions.close(); states.close()
  })
})
