"""平台 key 的用量记账与配额。

自带 key 的用户成本由自己承担,不设限;只有走平台 key 的调用需要判定放行。
记账与放行是两件事:record_call 对两种来源都记(运营需要看总量),check_quota
只管平台调用。默认策略仅有一个每日调用上限,商业版用 set_quota_policy 换成
订阅判定即可,不必改动这里。
"""

import logging
import sqlite3

from backend.config import settings

logger = logging.getLogger("uvicorn")

USER = "user"
PLATFORM = "platform"


class QuotaExceeded(RuntimeError):
    """平台额度用尽。映射为 402,前端据此引导到订阅页。"""

    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


def _get_conn() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_usage_table():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS llm_usage (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           TEXT NOT NULL,
            source            TEXT NOT NULL,
            model             TEXT NOT NULL DEFAULT '',
            prompt_tokens     INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 配额查询固定按 (用户, 来源, 当天) 过滤
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_llm_usage_lookup "
        "ON llm_usage (user_id, source, created_at)"
    )
    conn.commit()
    conn.close()


def record_call(
    user_id: str | None,
    source: str,
    model: str = "",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> None:
    """记一次调用。记账失败不能拖垮正在服务的请求,所以只记日志不抛。"""
    if not user_id:
        return
    try:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO llm_usage (user_id, source, model, prompt_tokens, completion_tokens) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, source, model, prompt_tokens or 0, completion_tokens or 0),
        )
        conn.commit()
        conn.close()
    except Exception:
        logger.exception("记录 LLM 用量失败 user=%s", user_id)


def platform_calls_today(user_id: str) -> int:
    """今日平台调用次数。日界按 UTC——与 CURRENT_TIMESTAMP 一致。这只是防刷用的
    粗粒度闸门,订阅本身按到期时间算,不受这个日界影响。"""
    conn = _get_conn()
    row = conn.execute(
        "SELECT COUNT(*) FROM llm_usage "
        "WHERE user_id = ? AND source = ? AND date(created_at) = date('now')",
        (user_id, PLATFORM),
    ).fetchone()
    conn.close()
    return row[0]


def _default_policy(user_id: str) -> None:
    limit = settings.platform_daily_call_limit
    if limit <= 0:
        return
    used = platform_calls_today(user_id)
    if used >= limit:
        raise QuotaExceeded(
            f"今日平台额度已用完({used}/{limit})。"
            "可以在「设置」里填自己的 API Key 继续免费使用。"
        )


def _default_status(user_id: str) -> dict:
    limit = settings.platform_daily_call_limit
    return {
        "used": platform_calls_today(user_id),
        "limit": limit if limit > 0 else None,
    }


_policy = _default_policy
_status_reporter = _default_status


def set_quota_policy(policy) -> None:
    """替换配额策略(签名同 _default_policy:放行返回 None,拒绝抛 QuotaExceeded)。
    商业版在这里挂订阅判定。"""
    global _policy
    _policy = policy


def set_quota_status_reporter(reporter) -> None:
    """替换额度状态上报(返回 {"used": int, "limit": int | None},None 表示不限)。

    必须和 set_quota_policy 成对替换:策略决定拦不拦,上报决定界面显示什么。
    只换策略不换上报,订阅用户明明已放行,界面上却仍然显示"额度已用完"。
    """
    global _status_reporter
    _status_reporter = reporter


def check_quota(user_id: str | None, source: str) -> None:
    """平台调用前的放行判定;自带 key 直接放行。"""
    if source != PLATFORM or not user_id:
        return
    _policy(user_id)


def quota_status(user_id: str) -> dict:
    """当前额度状态,由生效中的策略自报。"""
    return _status_reporter(user_id)
