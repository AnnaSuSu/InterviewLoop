export const PERSONAL_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.markdown', '.csv', '.tsv', '.json',
  '.yaml', '.yml', '.xml', '.html', '.htm', '.rtf', '.log', '.py', '.js', '.jsx', '.ts', '.tsx',
  '.java', '.go', '.rs', '.sql', '.css', '.sh',
])
export const MAX_PERSONAL_DOCUMENT_BYTES = 20 * 1024 * 1024

export type PersonalDocument = {
  document_id: string
  user_id?: string
  filename: string
  stored_name?: string
  extension: string
  size_bytes: number
  status: 'indexing' | 'needs_reindex' | 'ready' | 'error'
  chunk_count: number
  error?: string | null
  created_at: string
  updated_at: string
}

export type AgentMessage = {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  sources?: Array<{ document_id: string; filename: string }>
}

export type PersonalAgentChatResult = {
  conversation_id: string
  title: string
  message: AgentMessage
}

export type PersonalConversation = {
  conversation_id: string
  user_id?: string
  title: string
  messages: AgentMessage[]
  created_at: string
  updated_at: string
}

export type PersonalDocumentHit = { document_id: string; source: string; content: string; score: number }
