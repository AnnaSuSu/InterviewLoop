"""Answer Coach — 结合策略树 + 完整对话上下文，流式生成回答建议。"""
import logging
import time
from collections.abc import AsyncIterator

from backend.llm_provider import HumanMessage, SystemMessage, get_copilot_llm
from backend.copilot.strategy_tree import StrategyTreeNavigator

logger = logging.getLogger("uvicorn")

_ADVISE_PROMPT = """你是一个面试教练，正在实时辅助候选人。HR 刚说了一句话，请给出候选人应该怎么回答的建议。

{conversation_section}HR 最新发言: {utterance}
候选人背景亮点: {highlights}
候选人弱点提醒: {weak_points}
已知回答要点参考: {key_points}

要求：
- 结合对话上下文和候选人背景，写一段完整的示例答案，200字以内，自然口语化
- 如果 HR 是在追问或要求展开，答案要衔接候选人之前说过的内容，不要重复
- 如涉及弱点领域，答案中要有合理引导和转移
- 直接输出一段完整的回答
直接输出答案文本，不要任何前缀、标记或 JSON 格式。"""


def _format_conversation(conversation: list[dict]) -> str:
    """将对话历史格式化为 prompt 段落。"""
    if not conversation:
        return ""
    lines = []
    for turn in conversation:
        role = "HR" if turn.get("role") == "hr" else "候选人"
        lines.append(f"  {role}: {turn['text']}")
    return "对话历史:\n" + "\n".join(lines) + "\n\n"


def prepare_advice_context(
    utterance: str,
    node_id: str | None,
    navigator: StrategyTreeNavigator,
    prep_state: dict,
    conversation: list[dict] | None = None,
) -> dict:
    """预处理策略树上下文，返回 risk_alert 和构建好的 prompt。"""
    risk_alert = None
    key_points: list[str] = []

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

    # 完整对话历史（不包含当前这句，当前这句在 utterance 里）
    conv_for_prompt = conversation[:-1] if conversation else []
    conversation_section = _format_conversation(conv_for_prompt)

    prompt = _ADVISE_PROMPT.format(
        utterance=utterance,
        highlights=highlight_text,
        weak_points=weak_text,
        key_points="; ".join(key_points[:5]) or "无",
        conversation_section=conversation_section,
    )
    return {"prompt": prompt, "risk_alert": risk_alert}


async def stream_advice(prompt: str) -> AsyncIterator[dict]:
    """流式调用 LLM。yield dict: {"type": "chunk", "text": ...} 或 {"type": "meta", ...}。"""
    llm = get_copilot_llm()
    logger.info(f"Answer Coach streaming: model={llm.model}")
    t0 = time.monotonic()
    chunk_count = 0
    first_token_ms = None
    try:
        async for token in llm.astream([
            SystemMessage(content="直接输出答案，不要 JSON 格式"),
            HumanMessage(content=prompt),
        ]):
            chunk_count += 1
            if chunk_count == 1:
                first_token_ms = round((time.monotonic() - t0) * 1000)
                logger.info(f"Answer Coach first token at {first_token_ms}ms")
                yield {"type": "meta", "first_token_ms": first_token_ms}
            yield {"type": "chunk", "text": token}
        total_ms = round((time.monotonic() - t0) * 1000)
        logger.info(f"Answer Coach completed in {total_ms}ms, {chunk_count} chunks")
        yield {"type": "done", "total_ms": total_ms, "chunk_count": chunk_count}
    except Exception as e:
        logger.error(f"Answer Coach failed after {time.monotonic() - t0:.1f}s: {type(e).__name__}: {e}")
        yield {"type": "done", "total_ms": round((time.monotonic() - t0) * 1000), "chunk_count": chunk_count}


def _find_risk_hint(node_id: str, prep_hints: list[dict]) -> dict | None:
    for hint in prep_hints:
        if hint.get("node_id") == node_id:
            return hint
    return None
