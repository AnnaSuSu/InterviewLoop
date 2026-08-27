import { useEffect } from "react";

import { fetchQuota } from "./api";
import { setQuota } from "./store";

/** 额度轮询间隔。够跟上"练了几轮"的变化,又不至于给后端添无谓负担。 */
const POLL_MS = 30_000;

/**
 * 只轮询、不渲染。额度显示在侧栏(见 SidebarQuota),而侧栏只在登录后的布局里,
 * 轮询挂在常驻的 cloud portal 上才不会随路由起停。
 */
export default function QuotaPoller() {
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

  return null;
}
