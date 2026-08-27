/**
 * 商业版前端挂载点。
 *
 * 独立的 portal root,不进 App 的组件树——这样上游的 App.tsx 一行都不用改,
 * 而那个文件每加一个路由就会变动,是冲突高发区。代价是拿不到 AuthContext,
 * 但这里需要的东西(token)本来就在 localStorage 里,authFetch 也直接读它。
 *
 * 由 main.tsx 里的一行 import 触发。
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { setApiErrorHandler } from "@/api/client";

import { fetchQuota } from "./api";
import PaywallModal from "./PaywallModal";
import QuotaPoller from "./QuotaPoller";
import { openPaywall, setQuota } from "./store";

function CloudOverlay() {
  return (
    <>
      <QuotaPoller />
      <PaywallModal />
    </>
  );
}

function mount() {
  const el = document.createElement("div");
  el.id = "cloud-root";
  document.body.appendChild(el);
  createRoot(el).render(
    <StrictMode>
      <CloudOverlay />
    </StrictMode>
  );
}

setApiErrorHandler((code) => {
  if (code !== "quota_exceeded") return;
  openPaywall();
  // 立刻重拉一次,否则侧栏额度条要等下一轮轮询才更新
  fetchQuota()
    .then(setQuota)
    .catch(() => {});
  return true; // 已接管:调用方不必再弹自己的错误提示
});

mount();
