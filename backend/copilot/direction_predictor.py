"""Direction Predictor — 多 agent 并行预测 HR 追问方向，每个 agent 独立视角。"""
import json
import asyncio
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from backend.llm_provider import get_copilot_llm
from backend.copilot.strategy_tree import StrategyTreeNavigator

logger = logging.getLogger("uvicorn")

# 预定义的预测 agent，每个有独立的预测视角
AGENT_CONFIGS: dict[str, dict] = {
    "tech_deep": {
        "name": "技术追问",
        "angle": "从技术细节和底层原理角度预测：HR接下来会追问哪个具体的技术实现或原理？",
    },
    "project_shift": {
        "name": "项目经验",
        "angle": "从项目经历角度预测：HR接下来会如何切换到候选人的实际项目案例或负责模块？",
    },
    "pressure": {
        "name": "压力质疑",
        "angle": "从压力面试角度预测：HR接下来会如何质疑、反驳或挑战候选人刚才的回答？",
    },
    "behavioral": {
        "name": "行为考察",
        "angle": "从行为面试角度预测：HR接下来会如何转向软技能、团队合作或职场经历的考察？",
    },
    "breadth": {
        "name": "横向扩展",
        "angle": "从知识广度角度预测：HR接下来会如何横向扩展到相关技术领域或考察知识边界？",
    },
}

_AGENT_PROMPT = """你是一个面试策略分析师。{angle}

当前 HR 考察话题: {topic}
候选人最近对话:
{recent_conversation}
{children_hint}
{correction_block}
预测一个最可能的追问方向，输出严格 JSON:
{{"node_id": null, "direction": "方向描述（10-20字）", "example_question": "具体问法示例"}}
只输出 JSON，不要其他内容。"""

_CORRECTION_HIT = """
## 上一轮预测反馈（命中）
上一句 HR 说: "{previous_utterance}"
你预测了「{predicted_direction}」，HR 实际问了「{actual_direction}」，方向正确。
继续沿此思路预测，可以进一步深挖。"""

_CORRECTION_MISS = """
## 上一轮预测反馈（未命中）
上一句 HR 说: "{previous_utterance}"
你预测了「{predicted_direction}」，HR 实际问了「{actual_direction}」，方向偏了。
请从你的视角重新判断，避免重复同类偏差。"""

_DEFAULT_AGENTS = ["tech_deep", "pressure", "project_shift"]


async def predict_directions(
    navigator: StrategyTreeNavigator,
    node_id: str | None,
    conversation: list[dict],
    enabled_agents: list[str] | None = None,
    timeout: float = 2.5,
    per_agent_corrections: dict[str, dict] | None = None,
) -> list[dict]:
    """并行运行所有启用的预测 agent，每个独立预测一个追问方向。

    Returns: [{agent_id, name, node_id, direction, example_question}]
    """
    agents = [a for a in (enabled_agents or _DEFAULT_AGENTS) if a in AGENT_CONFIGS]
    if not agents:
        agents = _DEFAULT_AGENTS

    recent = _format_recent(conversation, max_turns=4)
    topic = ""
    children_hint = ""
    if node_id:
        node = navigator.get_node(node_id)
        topic = node.get("topic", "") if node else ""
        children = navigator.get_children(node_id)
        if children:
            names = "、".join(c["topic"] for c in children[:4])
            children_hint = f"\n策略树参考追问方向（可参考也可超出）: {names}"

    tasks = [
        asyncio.create_task(
            _predict_single_agent(
                agent_id, AGENT_CONFIGS[agent_id],
                topic, recent, children_hint,
                correction=per_agent_corrections.get(agent_id) if per_agent_corrections else None,
                timeout=timeout,
            )
        )
        for agent_id in agents
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    predictions = []
    for agent_id, result in zip(agents, results):
        if isinstance(result, Exception):
            logger.warning(f"Agent {agent_id} failed: {result}")
            continue
        if result:
            predictions.append(result)

    return predictions


async def _predict_single_agent(
    agent_id: str,
    config: dict,
    topic: str,
    recent_conversation: str,
    children_hint: str,
    correction: dict | None,
    timeout: float,
) -> dict | None:
    correction_block = ""
    if correction:
        template = _CORRECTION_HIT if correction["was_hit"] else _CORRECTION_MISS
        correction_block = template.format(
            previous_utterance=correction["previous_utterance"],
            predicted_direction=correction["predicted_direction"],
            actual_direction=correction["actual_direction"],
        )

    prompt = _AGENT_PROMPT.format(
        angle=config["angle"],
        topic=topic or "未知",
        recent_conversation=recent_conversation,
        children_hint=children_hint,
        correction_block=correction_block,
    )
    llm = get_copilot_llm()
    try:
        resp = await asyncio.wait_for(
            llm.ainvoke([SystemMessage(content="只输出 JSON"), HumanMessage(content=prompt)]),
            timeout=timeout,
        )
        parsed = _parse_prediction(resp.content)
        if parsed:
            return {"agent_id": agent_id, "name": config["name"], **parsed}
    except asyncio.TimeoutError:
        logger.warning(f"Agent {agent_id} timed out")
    except Exception as e:
        logger.error(f"Agent {agent_id} error: {e}")
    return None


def _format_recent(conversation: list[dict], max_turns: int = 4) -> str:
    recent = conversation[-max_turns:] if len(conversation) > max_turns else conversation
    lines = []
    for msg in recent:
        role = "HR" if msg.get("role") == "hr" else "候选人"
        lines.append(f"{role}: {msg.get('text', '')}")
    return "\n".join(lines)


def _parse_prediction(raw: str) -> dict | None:
    try:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        result = json.loads(text)
        if isinstance(result, dict) and "direction" in result:
            return {
                "node_id": result.get("node_id"),
                "direction": str(result["direction"]),
                "example_question": str(result.get("example_question", "")),
            }
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Failed to parse prediction: {raw[:200]}")
    return None
