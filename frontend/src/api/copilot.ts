import { API_BASE, authFetch, type ApiResponse } from "./client";

/** 列出所有 Prep 会话 */
export async function listCopilotPreps(): Promise<
  ApiResponse<"/api/copilot/preps", "get">
> {
  const res = await authFetch(`${API_BASE}/copilot/preps`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 删除 Prep 会话 */
export async function deleteCopilotPrep(
  prepId: string
): Promise<ApiResponse<"/api/copilot/prep/{prep_id}", "delete">> {
  const res = await authFetch(`${API_BASE}/copilot/prep/${prepId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface StartCopilotPrepOptions {
  jdText: string;
  company?: string;
  position?: string;
}

/** 启动 Copilot Prep Phase */
export async function startCopilotPrep({
  jdText,
  company,
  position,
}: StartCopilotPrepOptions): Promise<ApiResponse<"/api/copilot/prep", "post">> {
  const form = new FormData();
  form.append("jd_text", jdText);
  if (company) form.append("company", company);
  if (position) form.append("position", position);

  const res = await authFetch(`${API_BASE}/copilot/prep`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 查询 Prep 进度 */
export async function getCopilotPrepStatus(
  prepId: string
): Promise<ApiResponse<"/api/copilot/prep/{prep_id}", "get">> {
  const res = await authFetch(`${API_BASE}/copilot/prep/${prepId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取策略树 */
export async function getCopilotStrategyTree(
  prepId: string
): Promise<ApiResponse<"/api/copilot/prep/{prep_id}/tree", "get">> {
  const res = await authFetch(`${API_BASE}/copilot/prep/${prepId}/tree`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
