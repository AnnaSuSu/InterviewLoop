export type Topic = { name: string; icon: string; dir: string }
export type TopicMap = Record<string, Topic>
export type KnowledgeFile = { filename: string; content: string }
export type QuestionGraph = { nodes: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> }

export const KNOWLEDGE_IMPORT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx'])
export const MAX_KNOWLEDGE_UPLOAD_BYTES = 20 * 1024 * 1024
