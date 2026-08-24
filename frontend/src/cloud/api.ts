import { authFetch, API_BASE } from "@/api/client";

export interface Quota {
  source: "user" | "platform";
  used: number;
  limit: number | null;
}

export interface Plan {
  key: string;
  label: string;
  price_cents: number;
  days: number;
}

export interface Subscription {
  active: boolean;
  expires_at: string | null;
  plans: Plan[];
}

export async function fetchQuota(): Promise<Quota | null> {
  const res = await authFetch(`${API_BASE}/usage/quota`);
  return res.ok ? ((await res.json()) as Quota) : null;
}

export async function fetchSubscription(): Promise<Subscription | null> {
  const res = await authFetch(`${API_BASE}/cloud/subscription`);
  return res.ok ? ((await res.json()) as Subscription) : null;
}

export function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}
