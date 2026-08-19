import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import type { CandidateProfilePort } from '../interview/ports.ts'
import type { InterviewSession, TaskRecord } from '../interview/model.ts'
import { fill } from '../interview/prompts.ts'
import { defaultProfile, type CandidateProfile, type WeakPoint } from './model.ts'
import type { ProfileDependencies, ProfileUseCases } from './ports.ts'

const INFER_ROLE_PROMPT = `根据以下简历内容，推断候选人最可能应聘的岗位名称。给出一个具体岗位，12 个汉字以内；学生可带实习生或校招后缀。只返回岗位名称，不要解释。\n\n{resume}`
const EXTRACT_PROMPT = `你是面试教练分析引擎。根据本次面试记录提取结构化洞察。不要把表达习惯混入知识弱点，不得编造记录中没有的事实。\n\n模式：{mode}\n领域：{topic}\n对话：\n{transcript}\n\n复盘：\n{review}\n\n只返回 JSON：{"session_summary":"摘要","weak_points":[{"point":"具体知识薄弱点","topic":"领域"}],"strong_points":[{"point":"具体知识强项","topic":"领域"}],"behavior_signals":[{"action":"ADD","id":"reasoning.example","namespace":"reasoning","polarity":"negative","description":"行为描述","snippet":"原话"}],"topic_mastery":{"notes":"掌握情况"},"avg_score":7}`
const RETROSPECTIVE_PROMPT = `你是面试教练，请基于「{topic_name}」的多次训练历史生成 Markdown 回顾。总结进步趋势、稳定强项、反复薄弱点，并给出下一轮训练计划。每个判断必须能在历史中找到依据。\n\n当前掌握度：{mastery}\n\n训练历史：\n{history}`

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

function hydrate(value: CandidateProfile): CandidateProfile {
  const base = defaultProfile()
  return {
    ...base, ...value,
    topic_mastery: value.topic_mastery || {}, weak_points: value.weak_points || [], strong_points: value.strong_points || [], behavior_signals: value.behavior_signals || {},
    communication: { ...base.communication, ...(value.communication || {}) },
    thinking_patterns: { ...base.thinking_patterns, ...(value.thinking_patterns || {}) },
    stats: { ...base.stats, ...(value.stats || {}), score_history: value.stats?.score_history || [] },
  }
}

function salience(point: WeakPoint): number {
  const seen = String(point.last_seen || point.first_seen || '')
  const age = seen ? Math.max(0, (Date.now() - new Date(seen).getTime()) / 86_400_000) : 0
  return (0.5 ** (age / 30)) * (1 + Math.min(Math.log2(Number(point.times_seen || 1)), 2))
}

export function sm2Update(state: Record<string, unknown>, score: number, today = new Date()): Record<string, unknown> {
  const quality = score <= 2 ? 0 : score <= 4 ? 2 : score <= 5 ? 3 : score <= 7 ? 4 : 5
  let ease = Number(state.ease_factor || 2.5)
  let repetitions = Number(state.repetitions || 0)
  let interval: number
  if (quality >= 3) { interval = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.trunc(Number(state.interval_days || 1) * ease); repetitions += 1 }
  else { interval = 1; repetitions = 0 }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  const next = new Date(today.getTime()); next.setUTCDate(next.getUTCDate() + interval)
  return { interval_days: interval, ease_factor: Math.round(ease * 100) / 100, repetitions, next_review: next.toISOString().slice(0, 10), last_score: score }
}

export class ProfileService implements ProfileUseCases, CandidateProfilePort {
  constructor(private readonly deps: ProfileDependencies) {}

  private async profile(userId: string): Promise<CandidateProfile> { return hydrate(await this.deps.repository.load(userId)) }

  async get(context: RequestContext): Promise<CandidateProfile> {
    const userId = id(context)
    const profile = await this.profile(userId)
    return { ...profile, due_reviews: (await this.dueReviews(context)).map((point) => ({ point: point.point, topic: point.topic, next_review: object(point.sr).next_review })) }
  }

  async targetRole(userId: string): Promise<string> { return (await this.profile(userId)).target_role || '' }
  async updateTargetRole(userId: string, role: string): Promise<void> {
    const value = role.trim(); if (!value) return
    await this.deps.repository.update(userId, (profile) => { profile.target_role = value })
  }

  async addPredictedWeakPoints(input: { userId: string; topic: string; points: string[] }): Promise<void> {
    const now = new Date().toISOString()
    await this.deps.repository.update(input.userId, (profile) => {
      for (const raw of input.points) {
        const point = raw.trim(); if (!point) continue
        const existing = profile.weak_points.find((item) => item.point === point && item.topic === input.topic && !item.archived)
        if (existing) { existing.last_seen = now; existing.times_seen = Number(existing.times_seen || 1) + 1 }
        else profile.weak_points.push({ point, topic: input.topic, source: 'predicted', first_seen: now, last_seen: now, times_seen: 1, improved: false })
      }
    })
  }

  async summary(userId: string, topic?: string): Promise<string> {
    const profile = await this.profile(userId)
    const parts: string[] = []
    const weak = profile.weak_points.filter((point) => !point.improved && !point.archived && point.axis !== 'performance' && (!topic || point.topic === topic)).sort((a, b) => salience(b) - salience(a)).slice(0, topic ? 10 : 6)
    if (weak.length) parts.push(`已知知识薄弱点：${weak.map((point) => point.point).join('、')}`)
    const strong = [...profile.strong_points].sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || ''))).slice(0, 5)
    if (strong.length) parts.push(`知识强项：${strong.map((point) => point.point).join('、')}`)
    const behaviors = Object.entries(profile.behavior_signals).filter(([, value]) => !value.improved && (value.polarity || 'negative') === 'negative').slice(0, 6)
    if (behaviors.length) parts.push(`行为模式短板：\n${behaviors.map(([key, value]) => `- ${key}: ${value.description || ''}`).join('\n')}`)
    if (profile.stats.total_sessions) parts.push(`已完成 ${profile.stats.total_sessions} 次模拟面试`)
    if (topic) {
      const mastery = profile.topic_mastery[topic]
      if (mastery) parts.push(`${topic} 掌握度：${mastery.score ?? Number(mastery.level || 0) * 20}/100 — ${mastery.notes || ''}`)
    }
    return parts.join('\n') || '新用户，暂无历史数据'
  }

  async inferTargetRole(context: RequestContext) {
    const resume = await this.deps.resume.text(context)
    if (!resume) throw new AppError('请先上传简历', 400)
    const role = (await this.deps.ai.complete(context, [{ role: 'system', content: '你是岗位推断引擎。只返回岗位名称，不要其他内容。' }, { role: 'user', content: fill(INFER_ROLE_PROMPT, { resume }) }])).trim().replace(/^["「]|["」]$/g, '').trim()
    if (!role) throw new AppError('推断失败，请手动填写', 500)
    return { target_role: role }
  }

  async viewed(context: RequestContext): Promise<Record<string, unknown>> {
    return this.deps.repository.update(id(context), (profile) => {
      const marker = { at: new Date().toISOString(), total_sessions: Number(profile.stats?.total_sessions || 0), topic_scores: Object.fromEntries(Object.entries(profile.topic_mastery || {}).map(([topic, mastery]) => [topic, Number(mastery.score ?? Number(mastery.level || 0) * 20)])) }
      profile.view_marker = marker
      return marker
    })
  }

  async feedback(context: RequestContext, point: string, verdict: string): Promise<Record<string, unknown>> {
    if (!point.trim() || !['accurate', 'inaccurate', 'acknowledged'].includes(verdict)) throw new AppError('需要 point 和 verdict (accurate|inaccurate|acknowledged)', 400)
    const updated = await this.deps.repository.update(id(context), (profile) => {
      const target = profile.weak_points.find((item) => item.source === 'consolidated' && item.point === point && !item.archived)
      if (!target) return undefined
      const now = new Date().toISOString(); target.user_acknowledged = true
      const confidence = Number(target.confidence || 0.7)
      const history = Array.isArray(target.history) ? target.history : []
      target.history = history
      if (verdict === 'accurate') { target.confidence = Math.round(Math.min(1, confidence + 0.1) * 100) / 100; history.push({ date: now, event: 'user_confirmed' }) }
      if (verdict === 'inaccurate') { target.confidence = Math.round(Math.max(0, confidence - 0.3) * 100) / 100; history.push({ date: now, event: 'user_refuted' }); if (target.confidence < 0.5) Object.assign(target, { archived: true, archived_at: now, archived_reason: 'user_refuted' }) }
      return { ...target }
    })
    if (!updated) throw new AppError('未找到该规律', 404)
    return updated
  }

  async dueReviews(context: RequestContext, topic?: string): Promise<Array<Record<string, unknown>>> {
    const today = new Date().toISOString().slice(0, 10)
    return (await this.profile(id(context))).weak_points.filter((point) => !point.improved && !point.archived && point.source !== 'consolidated' && point.axis !== 'performance' && (!topic || point.topic === topic) && String(object(point.sr).next_review || '2000-01-01') <= today).sort((a, b) => Number(object(a.sr).ease_factor || 2.5) - Number(object(b.sr).ease_factor || 2.5))
  }

  async topicHistory(context: RequestContext, topic: string) { return this.deps.sessions.reviewedByTopic(id(context), topic) }

  async retrospective(context: RequestContext, topic: string) {
    const userId = id(context)
    if (!(await this.deps.sessions.reviewedByTopic(userId, topic)).length) throw new AppError('该领域暂无训练记录', 400)
    const taskId = `retro_${topic}_${userId.slice(0, 8)}`
    const existing = await this.deps.tasks.get(taskId, userId)
    if (!existing || !['pending', 'running'].includes(existing.status)) await this.deps.tasks.enqueue({ taskId, userId, type: 'retrospective', payload: { topic } })
    return { task_id: taskId, status: 'pending' as const }
  }

  async runRetrospectiveTask(task: TaskRecord): Promise<Record<string, unknown>> {
    const topic = String(task.payload.topic || '')
    const sessions = await this.deps.sessions.reviewedByTopic(task.user_id, topic)
    if (!sessions.length) throw new Error('该领域暂无训练记录')
    const profile = await this.profile(task.user_id)
    const topics = await this.deps.knowledgeStore.loadTopics(task.user_id)
    const topicName = topics[topic]?.name || topic
    const history = sessions.map((session) => `### ${session.created_at.slice(0, 10)}\n${session.review || ''}\n评分：${JSON.stringify(session.scores)}`).join('\n\n')
    const mastery = profile.topic_mastery[topic] || {}
    const context: RequestContext = { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal }
    const retrospective = (await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试教练。用 Markdown 生成回顾报告。' }, { role: 'user', content: fill(RETROSPECTIVE_PROMPT, { topic_name: topicName, mastery: `${mastery.score ?? Number(mastery.level || 0) * 20}/100 — ${mastery.notes || ''}`, history }) }])).trim()
    const at = new Date().toISOString()
    await this.deps.repository.update(task.user_id, (value) => { (value.topic_mastery[topic] ||= {}).retrospective = retrospective; value.topic_mastery[topic]!.retrospective_at = at })
    return { topic, topic_name: topicName, retrospective, retrospective_at: at, session_count: sessions.length }
  }

  async afterReview(input: { userId: string; session: InterviewSession }): Promise<Record<string, unknown>> {
    const transcript = input.session.transcript.map((message) => `${message.role === 'user' ? '候选人' : '面试官'}: ${message.content}`).join('\n')
    const context: RequestContext = { requestId: `profile:${input.session.session_id}`, userId: input.userId, signal: new AbortController().signal }
    let extraction: Record<string, unknown> | undefined
    for (let attempt = 0; attempt < 2 && !extraction; attempt += 1) {
      try { const parsed = parseJsonResponse(await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试分析引擎。只返回 JSON。' }, { role: 'user', content: fill(EXTRACT_PROMPT, { mode: input.session.mode, topic: input.session.topic || '综合', transcript, review: input.session.review || '' }) }])); if (!Array.isArray(parsed)) extraction = parsed }
      catch { /* retry once */ }
    }
    if (!extraction) throw new Error('画像提取失败')
    const now = new Date().toISOString()
    await this.deps.repository.update(input.userId, (profile) => {
      const weak = Array.isArray(extraction!.weak_points) ? extraction!.weak_points : []
      for (const raw of weak) {
        const item = object(raw); const point = String(item.point || '').trim(); if (!point) continue
        const topic = String(item.topic || input.session.topic || '')
        const existing = profile.weak_points.find((value) => value.point === point && value.topic === topic && !value.archived)
        if (existing) { existing.last_seen = now; existing.times_seen = Number(existing.times_seen || 1) + 1; existing.improved = false }
        else profile.weak_points.push({ ...item, point, topic, source: String(item.source || 'observed'), first_seen: now, last_seen: now, times_seen: 1, improved: false, sr: sm2Update({}, number(extraction!.avg_score) || 5) })
      }
      const strong = Array.isArray(extraction!.strong_points) ? extraction!.strong_points : []
      for (const raw of strong) { const item = object(raw); const point = String(item.point || '').trim(); if (point && !profile.strong_points.some((value) => value.point === point)) profile.strong_points.push({ ...item, point, topic: String(item.topic || input.session.topic || ''), first_seen: now }) }
      const behaviors = Array.isArray(extraction!.behavior_signals) ? extraction!.behavior_signals : []
      for (const raw of behaviors) { const item = object(raw); const key = String(item.id || '').trim(); if (!key) continue; const current = profile.behavior_signals[key] || {}; profile.behavior_signals[key] = { ...current, ...item, first_seen: current.first_seen || now, last_seen: now, times_seen: Number(current.times_seen || 0) + 1 } }
      if (input.session.topic && extraction!.topic_mastery) profile.topic_mastery[input.session.topic] = { ...(profile.topic_mastery[input.session.topic] || {}), ...object(extraction!.topic_mastery) }
      const stats = profile.stats
      stats.total_sessions += 1
      if (input.session.mode === 'resume') stats.resume_sessions += 1
      if (input.session.mode === 'topic_drill') stats.drill_sessions += 1
      if (input.session.mode === 'jd_prep') stats.job_prep_sessions += 1
      if (input.session.mode === 'recording') stats.recording_sessions = Number(stats.recording_sessions || 0) + 1
      const avg = number(object(input.session.overall).avg_score) ?? number(extraction!.avg_score)
      if (avg !== undefined) { stats.score_history.push({ date: now.slice(0, 10), mode: input.session.mode, topic: input.session.topic, avg_score: avg }); const values = stats.score_history.map((item) => number(item.avg_score)).filter((value): value is number => value !== undefined); stats.avg_score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 }
    })
    return extraction
  }
}
