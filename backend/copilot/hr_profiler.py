"""HR Profiler — 后台 agent，分析 HR 沟通风格和偏好。

每 3-4 轮对话触发一次，累积分析 HR 的说话模式、关注点、满意度信号。
"""
import logging
import json
import time

from backend.llm_provider import HumanMessage, SystemMessage, get_copilot_llm

logger = logging.getLogger("uvicorn")

_HR_PROFILE_PROMPT = """你是一个面试沟通分析师。根据以下面试对话，分析 HR 面试官的沟通风格和偏好。

对话记录:
{conversation}

请分析：
1. HR 的提问风格（直接/委婉、开放式/封闭式、追问深度偏好）
2. HR 的关注重点（更在意技术深度还是项目经验还是软技能）
3. 满意度信号（哪些回答 HR 继续追问了 = 感兴趣，哪些直接跳过换话题了 = 不满意或已满足）
4. 给候选人的回答策略建议（基于 HR 的风格，候选人应该怎么调整回答方式）

输出严格 JSON:
{{
  "style": "1句话描述 HR 的提问风格",
  "focus": "HR 最关注什么",
  "satisfaction_signals": "哪些回答效果好/不好",
  "advice": "给候选人的策略建议，2-3句话，直接实用"
}}
只输出 JSON，不要其他内容。"""


def should_run(turn_count: int) -> bool:
    """判断是否该触发 HR Profiler（每 3 轮）。"""
    return turn_count >= 3 and turn_count % 3 == 0


async def analyze_hr(conversation: list[dict]) -> dict | None:
    """分析 HR 沟通风格。返回分析结果 dict 或 None（失败时）。"""
    if len(conversation) < 3:
        return None

    conv_text = "\n".join(
        f"{'HR' if t['role'] == 'hr' else '候选人'}: {t['text']}"
        for t in conversation
    )

    llm = get_copilot_llm()
    t0 = time.monotonic()
    try:
        resp = await llm.ainvoke([
            SystemMessage(content="只输出 JSON"),
            HumanMessage(content=_HR_PROFILE_PROMPT.format(conversation=conv_text)),
        ])
        logger.info(f"HR Profiler completed in {time.monotonic() - t0:.1f}s")
        return _parse_profile(resp)
    except Exception as e:
        logger.error(f"HR Profiler failed after {time.monotonic() - t0:.1f}s: {type(e).__name__}: {e}")
        return None


def _parse_profile(raw: str) -> dict | None:
    try:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"HR Profiler parse failed: {raw[:200]}")
    return None
