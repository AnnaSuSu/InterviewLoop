"""Usage / quota routes."""

from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.llm_provider import resolve_llm_config
from backend.usage import PLATFORM, quota_status

router = APIRouter(prefix="/api")


@router.get("/usage/quota")
def get_quota(user_id: str = Depends(get_current_user)):
    """当前用户的额度状态。

    source="user" 表示用的是自己的 key,不受平台额度约束,limit 为 None——
    前端据此整块不渲染。source="platform" 且 limit 为 None 表示当前策略对这个
    用户不设上限(部署方没配上限,或下游策略判定其无需受限)。

    上限取自生效中的配额策略而非直接读配置:两者一旦分头取值,替换过策略的
    部署就会出现"放行了却显示额度已满"。
    """
    source = resolve_llm_config(user_id)["source"]
    if source != PLATFORM:
        return {"source": source, "used": 0, "limit": None}
    return {"source": PLATFORM, **quota_status(user_id)}
