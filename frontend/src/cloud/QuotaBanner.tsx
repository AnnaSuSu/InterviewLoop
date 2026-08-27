import { useEffect, useSyncExternalStore } from "react";
import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

import { fetchQuota } from "./api";
import { getState, openPaywall, setQuota, subscribe } from "./store";

/** 额度轮询间隔。够跟上"练了几轮"的变化,又不至于给后端添无谓负担。 */
const POLL_MS = 30_000;

export default function QuotaBanner() {
  const { quota } = useSyncExternalStore(subscribe, getState);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchQuota()
        .then((q) => alive && setQuota(q))
        .catch(() => {
          /* 额度显示不到位不影响主流程，静默即可 */
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // 自带 key 的用户不受平台额度约束;部署方没设上限时也没什么可显示的。
  if (!quota || quota.source !== "platform" || quota.limit === null) return null;

  const remaining = Math.max(0, quota.limit - quota.used);
  const ratio = quota.used / quota.limit;

  return (
    <button
      type="button"
      onClick={openPaywall}
      className={cn(
        "fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full",
        "border border-border bg-card/95 px-3.5 py-2 text-xs font-medium",
        "text-card-foreground shadow-lg backdrop-blur transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        ratio >= 0.8 && "border-amber-500/60 text-amber-600 dark:text-amber-400"
      )}
    >
      <Zap className="h-3.5 w-3.5" />
      <span>
        今日免费额度 {quota.used}/{quota.limit}
      </span>
      {remaining === 0 && <span className="text-amber-600 dark:text-amber-400">· 已用完</span>}
    </button>
  );
}
