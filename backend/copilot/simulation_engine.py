"""Simulation Engine — MCTS Rollout 模拟器。

三级降级策略:
  Level 1/2: 轻量 LLM 对话模拟 (API 或本地)
  Level 3:   纯 Reward 评估 (无 LLM)
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from langchain_core.messages import SystemMessage, HumanMessage

from backend.copilot.mcts_config import MCTSNode

if TYPE_CHECKING:
    from langchain_openai import ChatOpenAI
    from backend.copilot.reward_model import RewardModel

logger = logging.getLogger("uvicorn")

_HR_SIM_PROMPT = """你是面试官，根据对话简短追问一个技术问题。
当前话题: {topic}
对话摘要: {conversation}
只输出一句追问，不超过 30 字。"""

_CANDIDATE_SIM_PROMPT = """你是候选人，简短回答面试问题。
候选人强项: {highlights}
对话摘要: {conversation}
只输出一句回答，不超过 50 字。"""


class SimulationEngine:
    """面试对话模拟器。"""

    def __init__(
        self,
        reward_model: RewardModel,
        rollout_llm: ChatOpenAI | None = None,
        max_rollout_depth: int = 2,
    ):
        self.reward_model = reward_model
        self.rollout_llm = rollout_llm
        self.max_rollout_depth = max_rollout_depth

    async def rollout(self, node: MCTSNode, context: dict) -> float:
        """从给定节点模拟面试对话，返回终局评分 [0, 1]。"""
        if self.rollout_llm is None:
            return self.reward_model.evaluate(node)

        sim_conversation = list(node.conversation_snapshot[-6:])  # keep last 6 turns
        path_nodes = [node]

        try:
            for _ in range(self.max_rollout_depth):
                # HR 追问
                hr_q = await self._generate_hr_move(sim_conversation, node.topic)
                sim_conversation.append({"role": "hr", "text": hr_q})

                # 候选人回答
                cand_a = await self._generate_candidate_move(sim_conversation, context)
                sim_conversation.append({"role": "candidate", "text": cand_a})

                # 创建虚拟评分节点
                sim_node = MCTSNode(
                    id=MCTSNode.make_id(),
                    topic=node.topic,
                    action=cand_a,
                    conversation_snapshot=sim_conversation[-4:],
                )
                path_nodes.append(sim_node)
        except Exception as e:
            logger.warning(f"SimulationEngine LLM rollout failed, fallback to reward: {e}")
            return self.reward_model.evaluate(node)

        return self.reward_model.evaluate_path(path_nodes)

    async def _generate_hr_move(self, conversation: list[dict], topic: str) -> str:
        conv_text = " | ".join(
            f"{'HR' if t['role'] == 'hr' else '候选人'}: {t['text'][:60]}"
            for t in conversation[-4:]
        )
        resp = await self.rollout_llm.ainvoke([
            SystemMessage(content="只输出一句话"),
            HumanMessage(content=_HR_SIM_PROMPT.format(topic=topic, conversation=conv_text)),
        ])
        return resp.content.strip()[:100]

    async def _generate_candidate_move(self, conversation: list[dict], context: dict) -> str:
        highlights = "; ".join(str(h) for h in context.get("highlights", [])[:3]) or "无"
        conv_text = " | ".join(
            f"{'HR' if t['role'] == 'hr' else '候选人'}: {t['text'][:60]}"
            for t in conversation[-4:]
        )
        resp = await self.rollout_llm.ainvoke([
            SystemMessage(content="只输出一句话"),
            HumanMessage(content=_CANDIDATE_SIM_PROMPT.format(
                highlights=highlights, conversation=conv_text,
            )),
        ])
        return resp.content.strip()[:150]
