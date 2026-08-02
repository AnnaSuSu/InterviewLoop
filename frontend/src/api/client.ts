// 带鉴权的 fetch 封装 + openapi 类型接线,供 api/ 各模块共用
import type { paths } from "./schema";

export const API_BASE = "/api";

type JsonBody<T> = T extends { content: { "application/json": infer J } }
  ? J
  : unknown;

/**
 * 按路径/方法从生成的 openapi schema 提取 200 响应的 JSON 类型。
 * 后端目前未声明 response_model,一律解析为 unknown;
 * 后端补上后运行 `npm run gen:api` 重新生成 schema,这里会自动收窄,api 函数无需改动。
 */
export type ApiResponse<
  P extends keyof paths,
  M extends keyof paths[P],
> = paths[P][M] extends { responses: { 200: infer R } } ? JsonBody<R> : unknown;

function authHeaders(extra: HeadersInit = {}): Record<string, string> {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = authHeaders(options.headers);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

/** SSE 流式响应逐行解析:data: {json} 格式,每解析出一条调用 onEvent */
export async function consumeSSE(
  res: Response,
  onEvent: (data: Record<string, unknown>) => boolean | void
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (onEvent(data) === true) return; // 返回 true 表示流结束
      } catch {
        /* ignore malformed lines */
      }
    }
  }
}
