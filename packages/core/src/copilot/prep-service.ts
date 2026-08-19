import type { RequestContext } from '../kernel/context.ts'
import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { fill } from '../interview/prompts.ts'
import type { TaskRecord } from '../interview/model.ts'
import type { CopilotDependencies, CopilotPrepUseCases, SearchResult } from './ports.ts'
import { COPILOT_COMPANY_PROMPT, COPILOT_FIT_PROMPT, COPILOT_JD_PROMPT, COPILOT_RISK_PROMPT, COPILOT_STRATEGY_PROMPT } from './prompts.ts'

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function parseObject(text: string, fallback: Record<string, unknown>): Record<string, unknown> { try { return object(parseJsonResponse(text)) } catch { return fallback } }
function json(value: unknown): string { return JSON.stringify(value, null, 2) }
function newContext(task: TaskRecord): RequestContext { return { requestId: `task:${task.task_id}`, userId: task.user_id, signal: new AbortController().signal } }

export class CopilotPrepService implements CopilotPrepUseCases {
  constructor(private readonly deps: CopilotDependencies) {}

  async start(context: RequestContext, input: { jd_text: string; company?: string; position?: string }): Promise<{ prep_id: string }> {
    const userId = id(context)
    if (!input.jd_text.trim()) throw new AppError('JD must not be blank.', 400)
    const prepId = this.deps.ids.next()
    await this.deps.repository.createPrep({ prepId, userId, company: (input.company || '').trim(), position: (input.position || '').trim(), jdText: input.jd_text })
    try { await this.deps.tasks.enqueue({ taskId: `copilot_prep:${prepId}`, userId, type: 'copilot_prep', payload: { prep_id: prepId } }) }
    catch (error) { await this.deps.repository.failPrep(prepId, userId, error instanceof Error ? error.message : String(error)); throw error }
    return { prep_id: prepId }
  }

  async get(context: RequestContext, prepId: string): Promise<Record<string, unknown>> {
    const prep = await this.deps.repository.getPrep(prepId, id(context))
    if (!prep) throw new AppError('Prep session not found', 404)
    const response: Record<string, unknown> = { status: prep.status, progress: prep.progress, error: prep.error, company: prep.company, position: prep.position }
    if (prep.status === 'done' && prep.result) for (const key of ['company_report', 'jd_analysis', 'fit_report', 'risk_map', 'risk_summary', 'prep_hints']) response[key] = prep.result[key] ?? (key.endsWith('map') || key.endsWith('hints') ? [] : '')
    return response
  }

  async list(context: RequestContext): Promise<Array<Record<string, unknown>>> {
    return (await this.deps.repository.listPreps(id(context))).map((prep) => ({ prep_id: prep.prep_id, company: prep.company, position: prep.position, jd_excerpt: prep.jd_text.slice(0, 80), status: prep.status, progress: prep.progress, created_at: prep.created_at }))
  }

  async tree(context: RequestContext, prepId: string): Promise<Record<string, unknown>> {
    const prep = await this.deps.repository.getPrep(prepId, id(context))
    if (!prep || prep.status !== 'done' || !prep.result) throw new AppError('Prep not ready', 404)
    return object(prep.result.question_strategy_tree)
  }

  async delete(context: RequestContext, prepId: string): Promise<{ ok: true }> {
    if (!(await this.deps.repository.deletePrep(prepId, id(context)))) throw new AppError('Prep session not found', 404)
    return { ok: true }
  }

  private async search(context: RequestContext, apiKey: string, company: string, position: string): Promise<SearchResult[]> {
    if (!apiKey) return []
    const queries = [`${company} ${position} 业务方向 技术场景 产品`, `${company} ${position} 面试经验 面试流程 考察重点`, `${company} 技术栈 工程文化 技术架构`]
    const groups = await Promise.all(queries.map(async (query) => { try { return await this.deps.search.search({ apiKey, query, maxResults: 3, signal: context.signal }) } catch { return [] } }))
    return groups.flat()
  }

  async runPrepTask(task: TaskRecord): Promise<Record<string, unknown>> {
    const prepId = String(task.payload.prep_id || '').trim()
    const prep = await this.deps.repository.getPrep(prepId, task.user_id)
    if (!prep) throw new Error('Prep session not found')
    const context = newContext(task)
    try {
      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在并行分析公司信息、岗位要求和简历匹配度...')
      const [services, resumeText, profileSummary, profile] = await Promise.all([
        this.deps.settings.loadProvider(task.user_id).then((value) => value.services),
        this.deps.resume.text(context).catch(() => ''),
        this.deps.profile.summary(task.user_id),
        this.deps.profile.get ? this.deps.profile.get(context).catch((): Record<string, unknown> => ({})) : Promise.resolve<Record<string, unknown>>({}),
      ])
      const company = (async () => {
        const results = await this.search(context, services.tavily_api_key, prep.company, prep.position)
        if (!results.length) return JSON.stringify({ company_name: prep.company || '未知', tech_stack: [], interview_style: '无法获取（未配置搜索 API 或搜索无结果）', culture_notes: '', common_focus_areas: [], sources: [] })
        return (await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试情报分析师。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_COMPANY_PROMPT, { company: prep.company, position: prep.position, results: json(results) }) }])).trim()
      })()
      const jd = this.deps.ai.complete(context, [{ role: 'system', content: '你是 JD 分析引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_JD_PROMPT, { jd_text: prep.jd_text.slice(0, 6000) }) }])
      const fit = this.deps.ai.complete(context, [{ role: 'system', content: '你是匹配分析引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_FIT_PROMPT, { jd_text: prep.jd_text.slice(0, 6000), resume_context: resumeText.slice(0, 5000) || '未上传简历', profile_summary: profileSummary }) }])
      const [companyReport, jdText, fitText] = await Promise.all([company, jd, fit])
      const jdAnalysis = parseObject(jdText, { role_title: '', required_skills: [], likely_question_dimensions: [] })
      const fitReport = parseObject(fitText, { overall_fit: 0, highlights: [], gaps: [], talking_points: [] })

      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在生成 HR 提问策略树...')
      const strategy = parseObject(await this.deps.ai.complete(context, [{ role: 'system', content: '你是面试策略引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_STRATEGY_PROMPT, { role_title: jdAnalysis.role_title || '技术岗位', company_report: companyReport.slice(0, 3000), jd_analysis: json(jdAnalysis).slice(0, 3000), fit_report: json(fitReport).slice(0, 3000), profile_summary: profileSummary.slice(0, 3000) }) }]), { root_nodes: [], nodes: {}, phase_order: [] })

      await this.deps.repository.updatePrepProgress(prepId, task.user_id, '正在评估风险路径...')
      const nodes = object(strategy.nodes)
      const riskNodes = Object.entries(nodes).flatMap(([nodeId, raw]) => { const node = object(raw); return ['danger', 'caution'].includes(String(node.risk_level)) ? [{ node_id: nodeId, topic: node.topic || '', risk_level: node.risk_level }] : [] })
      let risk: Record<string, unknown> = { risk_map: [], prep_hints: [], risk_summary: '' }
      if (riskNodes.length) risk = parseObject(await this.deps.ai.complete(context, [{ role: 'system', content: '你是风险评估引擎。只返回 JSON。' }, { role: 'user', content: fill(COPILOT_RISK_PROMPT, { weak_points: json(Array.isArray(profile.weak_points) ? profile.weak_points.slice(0, 10) : []), gaps: json(Array.isArray(fitReport.gaps) ? fitReport.gaps.slice(0, 10) : []), risk_nodes: json(riskNodes) }) }]), risk)
      const result = { user_id: task.user_id, jd_text: prep.jd_text, resume_context: resumeText.slice(0, 2000), profile, company_report: companyReport, jd_analysis: jdAnalysis, fit_report: fitReport, question_strategy_tree: strategy, risk_map: Array.isArray(risk.risk_map) ? risk.risk_map : [], risk_summary: String(risk.risk_summary || ''), prep_hints: Array.isArray(risk.prep_hints) ? risk.prep_hints : [], status: 'done', progress: '准备完成', error: '' }
      await this.deps.repository.completePrep(prepId, task.user_id, result)
      const predicted = Array.isArray(fitReport.gaps) ? fitReport.gaps.flatMap((raw) => { const gap = object(raw); return gap.risk === 'high' && typeof gap.point === 'string' ? [gap.point] : [] }) : []
      if (predicted.length && this.deps.profile.addPredictedWeakPoints) { try { await this.deps.profile.addPredictedWeakPoints({ userId: task.user_id, topic: prep.position || '综合', points: predicted }) } catch { /* prep result remains usable */ } }
      return { prep_id: prepId, status: 'done' }
    } catch (error) {
      await this.deps.repository.failPrep(prepId, task.user_id, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500))
      throw error
    }
  }
}
