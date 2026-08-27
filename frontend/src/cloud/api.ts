import { authFetch, API_BASE } from "@/api/client";

export interface Quota {
  source: "user" | "platform";
  used: number;
  limit: number | null;
  /** token 按消耗量计，call 是仅按次数的兼容模式 */
  unit: "token" | "call";
  /** 计量窗口。subscription 表示按订阅期的额度包计 */
  window: "day" | "month" | "subscription";
}

/** 额度窗口的中文说法。订阅期的额度包不按自然周期滚动，所以只说「剩余」。 */
export function windowLabel(window: Quota["window"]): string {
  return window === "day" ? "今日额度" : window === "month" ? "本月额度" : "剩余额度";
}

export interface Tier {
  key: string;
  planId: string;
  label: string;
  price_cents: number;
  /** 订阅期内可用的 token 总量，0 表示不限 */
  token_quota: number;
}

export interface Subscription {
  active: boolean;
  expires_at: string | null;
  tier: string | null;
  plans: Tier[];
}

/** 当前登录用户的 ID，用于把订单和账号对上。取不到就返回空串。 */
export function currentUserId(): string {
  try {
    return (JSON.parse(localStorage.getItem("user") || "{}") as { id?: string }).id || "";
  } catch {
    return "";
  }
}

/**
 * 未登录时一律不打接口。
 *
 * 额度条挂在全局 portal 上,落地页也在跑;而 authFetch 遇到 401 会直接
 * window.location.href = "/login",于是「轮询 → 401 → 跳转 → 重新挂载 → 轮询」
 * 成环,表现为首页不停刷新。
 */
function signedIn(): boolean {
  return !!localStorage.getItem("token");
}

export async function fetchQuota(): Promise<Quota | null> {
  if (!signedIn()) return null;
  const res = await authFetch(`${API_BASE}/usage/quota`);
  return res.ok ? ((await res.json()) as Quota) : null;
}

export async function fetchSubscription(): Promise<Subscription | null> {
  if (!signedIn()) return null;
  const res = await authFetch(`${API_BASE}/cloud/subscription`);
  return res.ok ? ((await res.json()) as Subscription) : null;
}

export function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/** token 数按中文习惯折成「万」，原始位数对用户没有意义。 */
export function formatTokens(value: number): string {
  if (value >= 10_000) {
    const wan = value / 10_000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")} 万`;
  }
  return value.toLocaleString("zh-CN");
}
