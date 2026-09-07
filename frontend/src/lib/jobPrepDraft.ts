export function sanitizeJobPrepDraft(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const draft = value as Record<string, unknown>
  const preview = draft.preview
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return draft
  const record = preview as Record<string, unknown>
  const alignment = record.resume_alignment && typeof record.resume_alignment === 'object' && !Array.isArray(record.resume_alignment)
    ? record.resume_alignment as Record<string, unknown>
    : {}
  const strings = (items: unknown) => !Array.isArray(items) || items.every((item) => typeof item === 'string')
  const objects = (items: unknown, valid: (item: Record<string, unknown>) => boolean) => !Array.isArray(items) || items.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item) && valid(item as Record<string, unknown>))
  const renderable = (record.role_summary === undefined || typeof record.role_summary === 'string')
    && (alignment.fit_assessment === undefined || typeof alignment.fit_assessment === 'string')
    && strings(record.prep_priorities)
    && strings(alignment.risk_gaps)
    && strings(alignment.matching_evidence)
    && objects(record.focus_areas, (item) => typeof item.area === 'string' && (item.reason === undefined || typeof item.reason === 'string'))
    && objects(record.likely_question_groups, (item) => typeof item.title === 'string' && strings(item.sample_questions))
    && objects(alignment.recommended_stories, (item) => typeof item.project === 'string' && (item.reason === undefined || typeof item.reason === 'string'))
  return renderable ? draft : { ...draft, preview: null, previewSignature: '' }
}
