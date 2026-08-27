import { useSyncExternalStore } from "react";
import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { getState, openPaywall, subscribe } from "./store";

/**
 * 侧栏底部的额度条。
 *
 * 早先是右下角的悬浮角标,但那个角同时被 toast、移动端 FAB 和各页面的
 * sticky 底栏占着,必然互相压。挪进侧栏后彻底退出浮层争夺,顺带和下面的
 * "赞助项目"连成 额度 → 升级 的动线。
 */
export default function SidebarQuota({ collapsed }: { collapsed: boolean }) {
  const { quota } = useSyncExternalStore(subscribe, getState);

  // 自带 key 的用户不受平台额度约束;部署方没设上限时也没什么可显示的。
  if (!quota || quota.source !== "platform" || quota.limit === null) return null;

  const ratio = quota.limit > 0 ? quota.used / quota.limit : 0;
  const exhausted = quota.used >= quota.limit;
  const low = ratio >= 0.8;
  const tone = exhausted ? "text-red" : low ? "text-orange" : "text-dim";
  const bar = exhausted ? "bg-red" : low ? "bg-orange" : "bg-primary";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={openPaywall}
          className={cn(
            "w-full py-2 rounded-lg text-[13px] transition-all hover:bg-hover",
            tone,
            exhausted || low ? "hover:brightness-110" : "hover:text-text",
            collapsed && "flex justify-center"
          )}
        >
          {collapsed ? (
            <span className="relative">
              <Zap size={18} />
              {(exhausted || low) && (
                <span className={cn("absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full", bar)} />
              )}
            </span>
          ) : (
            <>
              <span className="flex items-center gap-2.5">
                <Zap size={18} className="shrink-0" />
                <span className="flex-1 text-left">今日额度</span>
                <span className="tabular-nums text-[12px]">
                  {quota.used}/{quota.limit}
                </span>
              </span>
              <span className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-hover">
                <span
                  className={cn("h-full rounded-full transition-[width] duration-500", bar)}
                  style={{ width: `${Math.min(100, ratio * 100)}%` }}
                />
              </span>
            </>
          )}
        </button>
      </TooltipTrigger>
      {collapsed && (
        <TooltipContent side="right" sideOffset={8}>
          今日免费额度 {quota.used}/{quota.limit}
          {exhausted && " · 已用完"}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
