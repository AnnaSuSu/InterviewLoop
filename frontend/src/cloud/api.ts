import { authFetch, API_BASE } from "@/api/client";

export interface Quota {
  source: "user" | "platform";
  used: number;
  limit: number | null;
}

export interface Tier {
  key: string;
  planId: string;
  label: string;
  price_cents: number;
  /** 每日调用上限，0 表示不限 */
  daily_limit: number;
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
