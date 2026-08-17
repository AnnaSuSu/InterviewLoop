"""Usage / quota routes."""

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.config import settings
from backend.llm_provider import resolve_llm_config
from backend.usage import PLATFORM, platform_calls_today

router = APIRouter(prefix="/api")


@router.get("/usage/quota")
def get_quota(user_id: str = Depends(get_current_user)):
    """当前用户的额度状态。

    source="user" 表示用的是自己的 key,不受平台额度约束,limit 为 None——
    前端据此整块不渲染。source="platform" 且 limit 为 None 表示部署方开了平台
    key 但没设上限。
    """
    source = resolve_llm_config(user_id)["source"]
    if source != PLATFORM:
        return {"source": source, "used": 0, "limit": None}
    limit = settings.platform_daily_call_limit
    return {
        "source": PLATFORM,
        "used": platform_calls_today(user_id),
        "limit": limit if limit > 0 else None,
    }
