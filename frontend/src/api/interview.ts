import { API_BASE, authFetch, consumeSSE, type ApiResponse } from "./client";

// 兼容旧引用:authFetch 历史上从本模块导出
export { authFetch } from "./client";

// ── Speech-to-text ──

export async function transcribeAudio(
  audioBlob: Blob
): Promise<ApiResponse<"/api/transcribe", "post">> {
  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  const res = await authFetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTopics(): Promise<ApiResponse<"/api/topics", "get">> {
  const res = await authFetch(`${API_BASE}/topics`);
  return res.json();
}

export async function createTopic(
  name: string,
  icon = "📝"
): Promise<ApiResponse<"/api/topics", "post">> {
  const res = await authFetch(`${API_BASE}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteTopic(
  key: string
): Promise<ApiResponse<"/api/topics/{key}", "delete">> {
  const res = await authFetch(`${API_BASE}/topics/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Resume ──

export async function getResumeStatus(): Promise<
  ApiResponse<"/api/resume/status", "get">
> {
  const res = await authFetch(`${API_BASE}/resume/status`);
  return res.json();
}

export async function uploadResume(
  file: File
): Promise<ApiResponse<"/api/resume/upload", "post">> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(`${API_BASE}/resume/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Interview ──

interface StartInterviewOptions {
  numQuestions?: number;
  divergence?: number;
  targetRole?: string;
}

export async function startInterview(
  mode: string,
  topic: string | null = null,
  { numQuestions, divergence, targetRole }: StartInterviewOptions = {}
): Promise<ApiResponse<"/api/interview/start", "post">> {
  const body: Record<string, unknown> = { mode, topic };
  if (numQuestions != null) body.num_questions = numQuestions;
  if (divergence != null) body.divergence = divergence;
  if (targetRole != null) body.target_role = targetRole;
  const res = await authFetch(`${API_BASE}/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function inferTargetRole(): Promise<
  ApiResponse<"/api/profile/infer-target-role", "post">
> {
  const res = await authFetch(`${API_BASE}/profile/infer-target-role`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function previewJobPrep(
  payload: Record<string, unknown>
): Promise<ApiResponse<"/api/job-prep/preview", "post">> {
  const res = await authFetch(`${API_BASE}/job-prep/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startJobPrep(
  payload: Record<string, unknown>
): Promise<ApiResponse<"/api/job-prep/start", "post">> {
  const res = await authFetch(`${API_BASE}/job-prep/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<ApiResponse<"/api/interview/chat", "post">> {
  const res = await authFetch(`${API_BASE}/interview/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface ChatStreamCallbacks {
  onToken?: (token: string) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
}

export async function sendMessageStream(
  sessionId: string,
  message: string,
  { onToken, onDone, onError }: ChatStreamCallbacks
): Promise<void> {
  const res = await authFetch(`${API_BASE}/interview/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await res.text());

  await consumeSSE(res, (data) => {
    if (data.error) {
      onError?.(new Error(String(data.error)));
      return true;
    }
    if (data.token) onToken?.(String(data.token));
    if (data.done) {
      onDone?.(data);
      return true;
    }
  });
}

export async function endInterview(
  sessionId: string,
  answers: Record<string, unknown> | null = null
): Promise<ApiResponse<"/api/interview/end/{session_id}", "post">> {
  const options: RequestInit = { method: "POST" };
  if (answers) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ answers });
  }
  const res = await authFetch(`${API_BASE}/interview/end/${sessionId}`, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveDraftAnswers(
  sessionId: string,
  answers: Record<string, unknown>
): Promise<ApiResponse<"/api/interview/draft/{session_id}", "post">> {
  const res = await authFetch(`${API_BASE}/interview/draft/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReview(
  sessionId: string
): Promise<ApiResponse<"/api/interview/review/{session_id}", "get">> {
  const res = await authFetch(`${API_BASE}/interview/review/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function retryReview(
  sessionId: string
): Promise<ApiResponse<"/api/interview/review/{session_id}/generate", "post">> {
  const res = await authFetch(
    `${API_BASE}/interview/review/${sessionId}/generate`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getResumableSession(
  sessionId: string
): Promise<ApiResponse<"/api/interview/session/{session_id}/resume", "get">> {
  const res = await authFetch(
    `${API_BASE}/interview/session/${sessionId}/resume`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTaskStatus(
  taskId: string
): Promise<ApiResponse<"/api/tasks/{task_id}", "get">> {
  const res = await authFetch(`${API_BASE}/tasks/${taskId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReferenceAnswer(
  sessionId: string,
  questionId: string
): Promise<ApiResponse<"/api/interview/reference-answer", "post">> {
  const res = await authFetch(`${API_BASE}/interview/reference-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHistory(
  limit = 20,
  offset = 0,
  mode: string | null = null,
  topic: string | null = null
): Promise<ApiResponse<"/api/interview/history", "get">> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (mode) params.set("mode", mode);
  if (topic) params.set("topic", topic);
  const res = await authFetch(`${API_BASE}/interview/history?${params}`);
  return res.json();
}

export async function deleteSession(
  sessionId: string
): Promise<ApiResponse<"/api/interview/session/{session_id}", "delete">> {
  const res = await authFetch(`${API_BASE}/interview/session/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getInterviewTopics(): Promise<
  ApiResponse<"/api/interview/topics", "get">
> {
  const res = await authFetch(`${API_BASE}/interview/topics`);
  return res.json();
}

// ── Graph ──

export async function getGraphData(
  topic: string
): Promise<ApiResponse<"/api/graph/{topic}", "get">> {
  const res = await authFetch(`${API_BASE}/graph/${topic}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Profile & Retrospective ──

export async function getProfile(): Promise<ApiResponse<"/api/profile", "get">> {
  const res = await authFetch(`${API_BASE}/profile`);
  return res.json();
}

export async function markProfileViewed(): Promise<
  ApiResponse<"/api/profile/viewed", "post">
> {
  const res = await authFetch(`${API_BASE}/profile/viewed`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendPatternFeedback(
  point: string,
  verdict: string
): Promise<ApiResponse<"/api/profile/pattern/feedback", "post">> {
  const res = await authFetch(`${API_BASE}/profile/pattern/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ point, verdict }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTopicRetrospective(
  topic: string
): Promise<ApiResponse<"/api/profile/topic/{topic}/retrospective", "post">> {
  const res = await authFetch(
    `${API_BASE}/profile/topic/${topic}/retrospective`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTopicHistory(
  topic: string
): Promise<ApiResponse<"/api/profile/topic/{topic}/history", "get">> {
  const res = await authFetch(`${API_BASE}/profile/topic/${topic}/history`);
  return res.json();
}

// ── Knowledge management ──

export async function getCoreKnowledge(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core", "get">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`
  );
  return res.json();
}

export async function updateCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "put">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteCoreKnowledge(
  topic: string,
  filename: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core/{filename}", "delete">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCoreKnowledge(
  topic: string,
  filename: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/core", "post">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateKnowledge(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/generate", "post">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/generate`,
    {
      method: "POST",
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Recording review ──

export async function transcribeRecording(
  audioBlob: Blob & { name?: string },
  mode = "dual"
): Promise<ApiResponse<"/api/recording/transcribe", "post">> {
  const form = new FormData();
  form.append("file", audioBlob, audioBlob.name || "recording.webm");
  form.append("mode", mode);
  const res = await authFetch(`${API_BASE}/recording/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function analyzeRecording(
  transcript: string,
  recordingMode: string,
  company?: string,
  position?: string
): Promise<ApiResponse<"/api/recording/analyze", "post">> {
  const body: Record<string, unknown> = {
    transcript,
    recording_mode: recordingMode,
  };
  if (company) body.company = company;
  if (position) body.position = position;
  const res = await authFetch(`${API_BASE}/recording/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHighFreq(
  topic: string
): Promise<ApiResponse<"/api/knowledge/{topic}/high_freq", "get">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`
  );
  return res.json();
}

export async function updateHighFreq(
  topic: string,
  content: string
): Promise<ApiResponse<"/api/knowledge/{topic}/high_freq", "put">> {
  const res = await authFetch(
    `${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Settings ──

export async function getSettings(): Promise<
  ApiResponse<"/api/settings", "get">
> {
  const res = await authFetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateSettings(
  payload: Record<string, unknown>
): Promise<ApiResponse<"/api/settings", "put">> {
  const res = await authFetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface LLMConnectionPayload {
  api_base?: string;
  api_key?: string;
  model?: string;
}

// 连接测试：探测「表单里当前填的」配置（尚未保存也能测），返回 { ok, error }
export async function testLLMConnection({
  api_base,
  api_key,
  model,
}: LLMConnectionPayload): Promise<
  ApiResponse<"/api/settings/test-llm", "post">
> {
  const res = await authFetch(`${API_BASE}/settings/test-llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_base, api_key, model }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function testEmbeddingConnection(
  payload: Record<string, unknown>
): Promise<ApiResponse<"/api/settings/test-embedding", "post">> {
  const res = await authFetch(`${API_BASE}/settings/test-embedding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface RebuildIndexCallbacks {
  /** data: { completed, total, label, status } */
  onProgress?: (data: Record<string, unknown>) => void;
  onDone?: (data: Record<string, unknown>) => void;
  onError?: (error: Error) => void;
}

export async function rebuildEmbeddingIndex({
  onProgress,
  onDone,
  onError,
}: RebuildIndexCallbacks = {}): Promise<void> {
  const res = await authFetch(`${API_BASE}/settings/rebuild-index`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());

  await consumeSSE(res, (data) => {
    if (data.fatal) {
      onError?.(new Error(String(data.error)));
      return true;
    }
    if (data.done) {
      onDone?.(data);
      return true;
    }
    onProgress?.(data);
  });
}
