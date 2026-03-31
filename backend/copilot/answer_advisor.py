"""Answer Advisor — 结合策略树预计算 + LLM 生成回答建议。"""
import json
import asyncio
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from backend.llm_provider import get_copilot_llm
from backend.copilot.strategy_tree import StrategyTreeNavigator

logger = logging.getLogger("uvicorn")

_ADVISE_PROMPT = """你是一个面试教练。HR 刚问了候选人一个问题，请给出答题框架和完整示例答案。

HR 的问题: {utterance}
候选人背景亮点: {highlights}
候选人弱点提醒: {weak_points}
已知回答要点参考: {key_points}

要求：
- framework: 2-4 步的答题结构，每步一句话
- full_answer: 结合候选人背景的完整示例答案，200 字以内，自然口语化
- 如涉及弱点领域，full_answer 中要有合理引导和转移
输出严格 JSON: {{"framework": ["步骤1", "步骤2", ...], "full_answer": "完整答案"}}
只输出 JSON，不要其他内容。"""


async def advise_answer(
    utterance: str,
    node_id: str | None,
    navigator: StrategyTreeNavigator,
    prep_state: dict,
    timeout: float = 3.0,
) -> dict:
    """生成答题框架和完整示例答案。

    Returns: {"framework": list[str], "full_answer": str, "risk_alert": str | None}
    """
    risk_alert = None
    key_points: list[str] = []

    # 从策略树取预计算要点作为 LLM 上下文，同时检查风险级别
    if node_id:
        node = navigator.get_node(node_id)
        if node:
            key_points = list(node.get("recommended_points", []))
            risk_level = node.get("risk_level", "safe")
            if risk_level == "danger":
                risk_hint = _find_risk_hint(node_id, prep_state.get("prep_hints", []))
                if risk_hint:
                    key_points.extend(risk_hint.get("safe_talking_points", []))
                    risk_alert = risk_hint.get("redirect_suggestion", "")
                else:
                    risk_alert = f"注意：'{node.get('topic', '')}' 是你的薄弱领域，建议简述核心概念后引导到实际项目经验"
            elif risk_level == "caution":
                risk_alert = f"提示：'{node.get('topic', '')}' 需要注意，确保回答有条理"

    fit_report = prep_state.get("fit_report", {})
    highlights = fit_report.get("highlights", []) if isinstance(fit_report, dict) else []
    highlight_text = "; ".join(
        h.get("point", str(h)) if isinstance(h, dict) else str(h)
        for h in highlights[:3]
    ) or "无"

    profile = prep_state.get("profile", {})
    weak_points = profile.get("weak_points", [])
    weak_text = "; ".join(
        wp.get("point", str(wp)) if isinstance(wp, dict) else str(wp)
        for wp in weak_points[:5]
    ) or "无"

    prompt = _ADVISE_PROMPT.format(
        utterance=utterance,
        highlights=highlight_text,
        weak_points=weak_text,
        key_points="; ".join(key_points[:5]) or "无",
    )
    llm = get_copilot_llm()
    try:
        resp = await asyncio.wait_for(
            llm.ainvoke([SystemMessage(content="只输出 JSON"), HumanMessage(content=prompt)]),
            timeout=timeout,
        )
        return {**_parse_advice(resp.content), "risk_alert": risk_alert}
    except asyncio.TimeoutError:
        logger.warning("Answer advisor timed out")
    except Exception as e:
        logger.error(f"Answer advisor failed: {e}")

    # 降级：用 key_points 拼一个基础框架
    return {
        "framework": key_points[:4] if key_points else ["明确问题", "结合经验举例", "总结结论"],
        "full_answer": "",
        "risk_alert": risk_alert,
    }


def _find_risk_hint(node_id: str, prep_hints: list[dict]) -> dict | None:
    for hint in prep_hints:
        if hint.get("node_id") == node_id:
            return hint
    return None


def _parse_advice(raw: str) -> dict:
    try:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        result = json.loads(text)
        if isinstance(result, dict):
            return {
                "framework": [str(s) for s in result.get("framework", [])],
                "full_answer": str(result.get("full_answer", "")),
            }
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Failed to parse answer advice: {raw[:200]}")
    return {"framework": [], "full_answer": ""}
