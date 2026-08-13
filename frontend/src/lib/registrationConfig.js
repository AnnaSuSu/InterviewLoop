const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 400;
const DEFAULT_TIMEOUT_MS = 5000;

const sleepFor = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

export async function loadRegistrationConfig({
  fetchImpl = globalThis.fetch,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleep = sleepFor,
} = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl("/api/auth/config", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`注册配置请求失败 (${response.status})`);
      }
      const data = await response.json();
      if (typeof data.allow_registration !== "boolean") {
        throw new Error("注册配置缺少 allow_registration");
      }
      return data.allow_registration;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
