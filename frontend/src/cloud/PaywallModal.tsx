import { useEffect, useState, useSyncExternalStore } from "react";
import { X, Check } from "lucide-react";

import AfdianIcon from "@/components/AfdianIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { currentUserId, fetchSubscription, formatPrice, type Subscription, type Tier } from "./api";
import { closePaywall, getState, subscribe } from "./store";

/**
 * 赞助页地址，由部署方配置；没配就不显示赞助按钮，自托管不需要它。
 * 钱不经过本服务——用户在收款平台付款，平台回调发放订阅。
 */
const SPONSOR_URL: string = import.meta.env.VITE_SPONSOR_URL || "";

/** 爱发电下单页。档位有 plan_id 时直连到该档位的收银台，省掉用户自己找档位。 */
const ORDER_URL = "https://ifdian.net/order/create";

export default function PaywallModal() {
  const { paywallOpen, quota } = useSyncExternalStore(subscribe, getState);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!paywallOpen) return;
    fetchSubscription()
      .then(setSub)
      .catch(() => setSub(null));
  }, [paywallOpen]);

  useEffect(() => {
    if (!paywallOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePaywall();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paywallOpen]);

  if (!paywallOpen) return null;

  const plans: Tier[] = sub?.plans ?? [];
  const chosen = selected || plans[0]?.key || "";
  // 弹窗有两个入口:额度耗尽时自动弹,和用户主动点角标提前升级。
  // 后者额度还没用完,再说"已用完"就是假话。
  const exhausted = quota?.limit != null && quota.used >= quota.limit;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={closePaywall}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closePaywall}
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="text-lg font-semibold text-card-foreground">
          {exhausted ? "今日免费额度已用完" : "开通后不限每日额度"}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {exhausted
            ? "赞助后额度会提升,可以继续训练。"
            : quota
              ? `免费额度每天 ${quota.limit} 次，赞助后按档位提升。`
              : "赞助后每日额度按档位提升。"}
        </p>

        <div className="mt-5 space-y-2">
          {plans.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setSelected(p.key)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border p-3.5 text-left transition-colors",
                chosen === p.key
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <div>
                <div className="text-sm font-medium text-card-foreground">{p.label}</div>
                <div className="text-xs text-muted-foreground">
                  {p.daily_limit > 0 ? `每天 ${p.daily_limit} 次` : "不限每日额度"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-card-foreground">
                  {formatPrice(p.price_cents)}
                </span>
                {chosen === p.key && <Check className="h-4 w-4 text-primary" />}
              </div>
            </button>
          ))}
        </div>

        {SPONSOR_URL && (
          <Button className="mt-5 w-full" onClick={() => openSponsorPage(plans.find((p) => p.key === chosen))}>
            <AfdianIcon size={15} className="mr-1.5" />
            去爱发电赞助
          </Button>
        )}

        {sub?.active && sub.expires_at && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            当前有效期至 {new Date(sub.expires_at).toLocaleDateString("zh-CN")}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 跳去付款页，并把本站用户 ID 挂在 custom_order_id 上。
 *
 * 平台会把这个字段原样带回订单回调，服务端据此认出是谁付的钱——不然两边是
 * 两套账号体系，只能让用户自己填备注再人工对账。
 *
 * 档位配了 plan_id 就直连该档位的下单页；没配则退回赞助主页，让用户自己选。
 */
function openSponsorPage(tier?: Tier): void {
  const url = new URL(tier?.planId ? ORDER_URL : SPONSOR_URL);
  if (tier?.planId) {
    url.searchParams.set("plan_id", tier.planId);
    url.searchParams.set("product_type", "0"); // 0 = 订阅方案
  }
  const userId = currentUserId();
  if (userId) url.searchParams.set("custom_order_id", userId);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}
