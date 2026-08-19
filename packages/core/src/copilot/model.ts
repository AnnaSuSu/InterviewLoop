export type CopilotPrepStatus = 'running' | 'done' | 'error'

export type CopilotPrepRecord = {
  prep_id: string
  user_id: string
  company: string
  position: string
  jd_text: string
  status: CopilotPrepStatus
  progress: string
  error: string
  result?: Record<string, unknown> | null
  created_at: string
}

export type CopilotConversationTurn = { role: 'hr' | 'candidate'; text: string; at: string }

export type CopilotSessionState = {
  session_id: string
  user_id: string
  prep_id: string
  conversation: CopilotConversationTurn[]
  last_node_id?: string | null
  turn_count: number
  status: 'active' | 'stopped'
  created_at: string
  updated_at: string
}

export type CopilotClientMessage =
  | { type: 'start'; prep_id?: string }
  | { type: 'manual'; text?: string }
  | { type: 'candidate_response'; text: string }
  | { type: 'stop' }

export type CopilotServerEvent = { type: string; [key: string]: unknown }
