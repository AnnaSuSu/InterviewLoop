"""Interview Monitor — 后台 agent，跟踪面试进程和候选人表现。

每次 HR+候选人完成一轮交互后触发，评估回答质量、跟踪话题覆盖、给出战略建议。
"""
import logging
import json
import time

from backend.llm_provider import HumanMessage, SystemMessage, get_copilot_llm

logger = logging.getLogger("uvicorn")

_MONITOR_PROMPT = """你是一个面试教练，正在实时监控一场面试。根据完整对话和岗位信息，给出当前面试状态分析。

对话记录:
{conversation}

岗位关键技能: {required_skills}
候选人亮点: {highlights}
候选人弱点: {weak_points}

请分析：
1. 当前面试阶段（opening/technical/project/behavioral/closing）
2. 候选人最近一次回答的表现评价（好在哪/差在哪，1句话）
3. 已覆盖的考察维度和未覆盖的
4. 给候选人的下一步战略建议（接下来该注意什么，1-2句话）

输出严格 JSON:
{{
  "phase": "当前阶段",
  "last_answer_feedback": "对最近回答的1句话评价，如果候选人还没回答过则为空",
  "covered_topics": ["已考察的维度"],
  "uncovered_topics": ["尚未考察但可能会问的维度"],
  "strategy_tip": "下一步战略建议"
}}
只输出 JSON，不要其他内容。"""


async def analyze_interview(
    conversation: list[dict],
    prep_state: dict,
) -> dict | None:
    """分析面试进程。返回分析结果 dict 或 None（失败时）。"""
    if not conversation:
        return None

    conv_text = "\n".join(
        f"{'HR' if t['role'] == 'hr' else '候选人'}: {t['text']}"
        for t in conversation
    )

    fit_report = prep_state.get("fit_report", {})
    highlights = fit_report.get("highlights", []) if isinstance(fit_report, dict) else []
    highlight_text = "; ".join(
        h.get("point", str(h)) if isinstance(h, dict) else str(h)
        for h in highlights[:5]
    ) or "无"

    jd_analysis = prep_state.get("jd_analysis", {})
    skills = jd_analysis.get("required_skills", []) if isinstance(jd_analysis, dict) else []
    skill_text = "; ".join(
        s.get("skill", str(s)) if isinstance(s, dict) else str(s)
        for s in skills[:10]
    ) or "无"

    profile = prep_state.get("profile", {})
    weak_points = profile.get("weak_points", [])
    weak_text = "; ".join(
        wp.get("point", str(wp)) if isinstance(wp, dict) else str(wp)
        for wp in weak_points[:5]
    ) or "无"

    llm = get_copilot_llm()
    t0 = time.monotonic()
    try:
        resp = await llm.ainvoke([
            SystemMessage(content="只输出 JSON"),
            HumanMessage(content=_MONITOR_PROMPT.format(
                conversation=conv_text,
                required_skills=skill_text,
                highlights=highlight_text,
                weak_points=weak_text,
            )),
        ])
        logger.info(f"Interview Monitor completed in {time.monotonic() - t0:.1f}s")
        return _parse_monitor(resp)
    except Exception as e:
        logger.error(f"Interview Monitor failed after {time.monotonic() - t0:.1f}s: {type(e).__name__}: {e}")
        return None


def _parse_monitor(raw: str) -> dict | None:
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
        logger.warning(f"Interview Monitor parse failed: {raw[:200]}")
    return None
