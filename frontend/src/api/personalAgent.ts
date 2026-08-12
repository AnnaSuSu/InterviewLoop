import { API_BASE, authFetch } from "./client";

export interface DocumentItem {
  document_id: string;
  filename: string;
  extension: string;
  size_bytes: number;
  status: "indexing" | "needs_reindex" | "ready" | "error";
  chunk_count: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSource {
  document_id: string;
  filename: string;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: AgentSource[];
}

export interface ConversationSummary {
  conversation_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface DocumentsResponse {
  items: DocumentItem[];
  supported_extensions: string[];
  max_upload_bytes: number;
}

interface ConversationsResponse {
  items: ConversationSummary[];
}

export interface ConversationDetail extends ConversationSummary {
  user_id: string;
  messages: AgentMessage[];
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "请求失败");
  }
  return response.json() as Promise<T>;
}

export async function getDocuments(): Promise<DocumentsResponse> {
  return parseResponse(await authFetch(`${API_BASE}/personal-agent/documents`));
}

export async function uploadDocument(file: File): Promise<DocumentItem> {
  const form = new FormData();
  form.append("file", file);
  return parseResponse(await authFetch(`${API_BASE}/personal-agent/documents`, {
    method: "POST",
    body: form,
  }));
}

export async function deleteDocument(documentId: string): Promise<void> {
  await parseResponse(await authFetch(`${API_BASE}/personal-agent/documents/${documentId}`, {
    method: "DELETE",
  }));
}

export async function getConversations(): Promise<ConversationsResponse> {
  return parseResponse(await authFetch(`${API_BASE}/personal-agent/conversations`));
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  return parseResponse(await authFetch(`${API_BASE}/personal-agent/conversations/${conversationId}`));
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await parseResponse(await authFetch(`${API_BASE}/personal-agent/conversations/${conversationId}`, {
    method: "DELETE",
  }));
}

export async function sendAgentMessage(
  message: string,
  conversationId?: string | null,
): Promise<{ conversation_id: string; title: string; message: AgentMessage }> {
  return parseResponse(await authFetch(`${API_BASE}/personal-agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversation_id: conversationId || null }),
  }));
}
