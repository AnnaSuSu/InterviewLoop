import type { InterviewAnswer, InterviewQuestion } from '../interview/model.ts'

function values(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function point(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) return String((value as Record<string, unknown>).point ?? JSON.stringify(value))
  return String(value)
}

export function formatDualReview(questions: InterviewQuestion[], answers: InterviewAnswer[], scores: Array<Record<string, unknown>>, overall: Record<string, unknown>): string {
  const answerMap = new Map(answers.map((answer) => [String(answer.question_id), answer.answer]))
  const scoreMap = new Map(scores.map((score) => [String(score.question_id), score]))
  const lines = [`## 整体评价\n\n${overall.summary || ''}\n\n**平均分: ${overall.avg_score ?? '-'}/10**\n`, '---\n\n## 逐题复盘\n']
  for (const question of questions) {
    const score = scoreMap.get(String(question.id)) || {}
    const answer = answerMap.get(String(question.id)) || ''
    if (!answer) { lines.push(`### Q${question.id} (${question.focus_area || ''}) — 未作答`, `**题目**: ${question.question}\n`); continue }
    lines.push(`### Q${question.id} (${question.focus_area || ''}) — ${score.score ?? '-'}/10`, `**题目**: ${question.question}`, `**你的回答**: ${answer}`)
    if (score.assessment) lines.push(`**点评**: ${score.assessment}`)
    if (score.improvement) lines.push(`**改进建议**: ${score.improvement}`)
    if (score.understanding) lines.push(`**理解程度**: ${score.understanding}`)
    if (values(score.key_missing).length) lines.push(`**遗漏关键点**: ${values(score.key_missing).join(', ')}`)
    lines.push('')
  }
  if (values(overall.new_weak_points).length) lines.push('---\n\n## 薄弱点', ...values(overall.new_weak_points).map((item) => `- ${point(item)}`))
  if (values(overall.new_strong_points).length) lines.push('\n## 亮点', ...values(overall.new_strong_points).map((item) => `- ${point(item)}`))
  return lines.join('\n')
}

export function formatSoloReview(topics: Array<Record<string, unknown>>, overall: Record<string, unknown>): string {
  const lines = [`## 整体评价\n\n${overall.summary || ''}\n\n**平均分: ${overall.avg_score ?? '-'}/10**\n`]
  if (topics.length) {
    lines.push('---\n\n## 涉及知识点\n')
    for (const item of topics) {
      lines.push(`### ${item.topic || '未知'} — ${item.score ?? '-'}/10`)
      if (item.assessment) lines.push(`**评价**: ${item.assessment}`)
      if (item.understanding) lines.push(`**理解程度**: ${item.understanding}`)
      if (values(item.errors).length) lines.push(`**错误**: ${values(item.errors).join(', ')}`)
      if (values(item.missing).length) lines.push(`**遗漏**: ${values(item.missing).join(', ')}`)
      lines.push('')
    }
  }
  if (values(overall.new_weak_points).length) lines.push('---\n\n## 薄弱点', ...values(overall.new_weak_points).map((item) => `- ${point(item)}`))
  if (values(overall.new_strong_points).length) lines.push('\n## 亮点', ...values(overall.new_strong_points).map((item) => `- ${point(item)}`))
  return lines.join('\n')
}
