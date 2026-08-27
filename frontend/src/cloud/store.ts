/**
 * 额度状态的极小订阅式 store。
 *
 * 不用 React Context:这套 UI 挂在独立的 portal root 上(见 index.tsx),不在
 * App 的组件树里,拿不到上层 Provider。而且 402 是在 fetch 封装里捕获的,那里
 * 本来就在 React 之外。
 */

import type { Quota } from "./api";

interface State {
  quota: Quota | null;
  paywallOpen: boolean;
}

let state: State = { quota: null, paywallOpen: false };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): State {
  return state;
}

export function setQuota(quota: Quota | null): void {
  state = { ...state, quota };
  emit();
}

export function openPaywall(): void {
  if (state.paywallOpen) return;
  state = { ...state, paywallOpen: true };
  emit();
}

export function closePaywall(): void {
  state = { ...state, paywallOpen: false };
  emit();
}
