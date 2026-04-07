"""MCTS Engine — 基于蒙特卡洛树搜索的动态策略引擎。

在候选人回答的时间窗口（30-120s）内异步展开博弈树，
评估候选人不同回答策略的后果，给出最优路径推荐。
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from typing import TYPE_CHECKING

import numpy as np

from backend.llm_provider import get_copilot_llm, get_embedding
from backend.copilot.mcts_config import MCTSConfig, MCTSNode, StrategyRecommendation

if TYPE_CHECKING:
    from backend.copilot.reward_model import RewardModel
    from backend.copilot.simulation_engine import SimulationEngine
    from backend.copilot.strategy_tree import StrategyTreeNavigator

logger = logging.getLogger("uvicorn")

_EXPANSION_PROMPT = """你是面试策略分析师。当前面试状态:

对话摘要: {conversation_summary}
当前话题: {current_topic}
{last_turn_label}: {last_turn_text}

现在轮到{next_actor_label}。
候选人强项: {highlights}
候选人弱项: {weak_points}

生成 {branch_factor} 个可能的{action_label}，带置信度。
输出严格 JSON 数组: [{{"action": "简短描述", "topic": "话题关键词", "confidence": 0.0到1.0}}]
只输出 JSON，不要其他内容。"""


class MCTSEngine:
    """MCTS 搜索引擎，每个面试会话一个实例。"""

    def __init__(
        self,
        strategy_navigator: StrategyTreeNavigator,
        reward_model: RewardModel,
        simulation_engine: SimulationEngine,
        prep_state: dict,
        config: MCTSConfig,
    ):
        self.navigator = strategy_navigator
        self.reward_model = reward_model
        self.sim_engine = simulation_engine
        self.prep_state = prep_state
        self.config = config

        # 博弈树
        self.nodes: dict[str, MCTSNode] = {}
        self.root_id: str | None = None
        self._search_task: asyncio.Task | None = None
        self._cancel_event = asyncio.Event()

        # 上下文
        self._conversation: list[dict] = []
        self._last_node_id: str | None = None

    # ------------------------------------------------------------------
    # 外部接口
    # ------------------------------------------------------------------

    async def on_hr_utterance(self, text: str, static_node_id: str | None):
        """HR 发言：停止上一轮搜索，更新真实位置，裁剪。"""
        await self._cancel_search()
        self._conversation.append({"role": "hr", "text": text})

        # 创建或更新根节点
        root = MCTSNode(
            id=MCTSNode.make_id(),
            actor="hr",
            action=text,
            topic=self._extract_topic(text, static_node_id),
            conversation_snapshot=self._conversation[-8:],
            strategy_tree_node_id=static_node_id,
            depth=0,
        )
        # 计算 embedding
        try:
            embed = get_embedding()
            root.action_embedding = await asyncio.to_thread(embed.get_text_embedding, text)
        except Exception:
            pass

        self.nodes = {root.id: root}
        self.root_id = root.id
        self._last_node_id = static_node_id

    async def on_candidate_response(self, text: str):
        """候选人回答：更新对话。"""
        await self._cancel_search()
        self._conversation.append({"role": "candidate", "text": text})

    async def search(self):
        """执行一轮 MCTS 搜索。"""
        if not self.root_id:
            return

        self._cancel_event.clear()
        t0 = time.monotonic()
        completed = 0

        for i in range(self.config.iterations):
            if self._cancel_event.is_set():
                break
            if time.monotonic() - t0 > self.config.search_timeout:
                logger.info(f"MCTS search timeout after {completed} iterations")
                break

            try:
                await self._run_iteration()
                completed += 1
            except Exception as e:
                logger.warning(f"MCTS iteration {i} failed: {e}")

        elapsed = time.monotonic() - t0
        logger.info(f"MCTS search: {completed}/{self.config.iterations} iters in {elapsed:.1f}s, "
                     f"{len(self.nodes)} nodes")

    def get_recommendation(self) -> StrategyRecommendation:
        """从当前博弈树提取最优策略推荐。"""
        if not self.root_id or self.root_id not in self.nodes:
            return StrategyRecommendation()

        root = self.nodes[self.root_id]
        if not root.children:
            return StrategyRecommendation(
                win_rate=root.q_value,
                iterations_completed=root.visit_count,
            )

        # 找最优候选人回答（visit_count 最高的子节点）
        child_nodes = [self.nodes[cid] for cid in root.children if cid in self.nodes]
        if not child_nodes:
            return StrategyRecommendation(win_rate=root.q_value)

        best_child = max(child_nodes, key=lambda n: n.visit_count)
        optimal_strategy = best_child.action

        # 预测 HR 追问 = best_child 的子节点
        predicted_followups = []
        for gc_id in best_child.children:
            gc = self.nodes.get(gc_id)
            if gc and gc.actor == "hr":
                prob = gc.visit_count / max(best_child.visit_count, 1)
                predicted_followups.append({
                    "question": gc.action,
                    "probability": round(prob, 2),
                    "risk_level": gc.risk_level,
                    "topic": gc.topic,
                })
        predicted_followups.sort(key=lambda x: x["probability"], reverse=True)

        # 危险区域
        danger_zones = []
        for n in self.nodes.values():
            if n.risk_level == "danger" and n.visit_count > 0 and n.q_value < 0.3:
                if n.topic and n.topic not in danger_zones:
                    danger_zones.append(n.topic)

        # 最优路径
        best_path = self._trace_best_path(root.id, max_depth=3)

        # 胜率
        win_rate = best_child.q_value

        return StrategyRecommendation(
            optimal_response_strategy=optimal_strategy,
            predicted_followups=predicted_followups[:5],
            danger_zones=danger_zones[:5],
            win_rate=round(win_rate, 3),
            best_path=best_path,
            confidence=round(best_child.visit_count / max(root.visit_count, 1), 2),
            iterations_completed=root.visit_count,
        )

    async def stop(self):
        await self._cancel_search()

    # ------------------------------------------------------------------
    # MCTS 四步
    # ------------------------------------------------------------------

    async def _run_iteration(self):
        """单次 MCTS 迭代: select → expand → simulate → backprop。"""
        # Selection
        leaf = self._select(self.root_id)

        # Expansion (如果未达深度上限且树未满)
        if leaf.depth < self.config.max_expansion_depth and len(self.nodes) < self.config.max_tree_nodes:
            children = await self._expand(leaf)
            if children:
                leaf = children[0]  # 用第一个新子节点做 simulation

        # Simulation
        context = {
            "highlights": self._get_highlights(),
            "weak_points": self._get_weak_points(),
        }
        reward = await self.sim_engine.rollout(leaf, context)

        # Backpropagation
        self._backpropagate(leaf.id, reward)

    def _select(self, root_id: str) -> MCTSNode:
        """PUCT 公式选择叶节点。"""
        node = self.nodes[root_id]
        while node.children:
            child_nodes = [self.nodes[cid] for cid in node.children if cid in self.nodes]
            if not child_nodes:
                break

            # 检查是否有未访问的子节点
            unvisited = [c for c in child_nodes if c.visit_count == 0]
            if unvisited:
                node = unvisited[0]
                break

            parent_visits = node.visit_count
            best_child = max(
                child_nodes,
                key=lambda c: (
                    c.q_value
                    + self.config.c_puct * c.prior * math.sqrt(parent_visits) / (1 + c.visit_count)
                ),
            )
            node = best_child
        return node

    async def _expand(self, leaf: MCTSNode) -> list[MCTSNode]:
        """LLM 生成候选动作，创建子节点。"""
        # 确定下一步是谁
        next_actor = "candidate" if leaf.actor == "hr" else "hr"
        next_actor_label = "候选人回答" if next_actor == "candidate" else "HR 追问"
        action_label = "回答策略" if next_actor == "candidate" else "追问方向"
        last_turn_label = "HR 最新问题" if leaf.actor == "hr" else "候选人最新回答"

        conv_summary = " | ".join(
            f"{'HR' if t['role'] == 'hr' else '候选人'}: {t['text'][:50]}"
            for t in leaf.conversation_snapshot[-4:]
        ) or "无"

        prompt = _EXPANSION_PROMPT.format(
            conversation_summary=conv_summary,
            current_topic=leaf.topic,
            last_turn_label=last_turn_label,
            last_turn_text=leaf.action[:200],
            next_actor_label=next_actor_label,
            highlights="; ".join(str(h) for h in self._get_highlights()[:3]) or "无",
            weak_points="; ".join(str(w) for w in self._get_weak_points()[:3]) or "无",
            branch_factor=self.config.branch_factor,
            action_label=action_label,
        )

        try:
            llm = get_copilot_llm()
            resp = await llm.ainvoke([
                {"role": "system", "content": "只输出 JSON 数组"},
                {"role": "user", "content": prompt},
            ])
            actions = self._parse_expansion(resp.content)
        except Exception as e:
            logger.warning(f"MCTS expansion LLM failed: {e}")
            return []

        embed = get_embedding()
        new_nodes: list[MCTSNode] = []
        for act in actions[: self.config.branch_factor]:
            child = MCTSNode(
                id=MCTSNode.make_id(),
                parent_id=leaf.id,
                actor=next_actor,
                action=act.get("action", ""),
                topic=act.get("topic", leaf.topic),
                prior=act.get("confidence", 0.5),
                depth=leaf.depth + 1,
                conversation_snapshot=leaf.conversation_snapshot + [
                    {"role": "hr" if leaf.actor == "hr" else "candidate", "text": leaf.action},
                ],
            )

            # Embedding
            try:
                child.action_embedding = await asyncio.to_thread(embed.get_text_embedding, child.action)
            except Exception:
                child.action_embedding = leaf.action_embedding

            # Risk level from reward model
            reward_score = self.reward_model.evaluate(child)
            if reward_score < 0.3:
                child.risk_level = "danger"
            elif reward_score < 0.5:
                child.risk_level = "caution"
            else:
                child.risk_level = "safe"

            # 尝试合并静态树
            self._try_merge_static(child)

            new_nodes.append(child)
            self.nodes[child.id] = child

        leaf.children = [n.id for n in new_nodes]
        return new_nodes

    def _backpropagate(self, node_id: str, reward: float):
        """从叶到根更新统计量。HR 节点翻转奖励。"""
        current_id: str | None = node_id
        while current_id is not None:
            node = self.nodes.get(current_id)
            if node is None:
                break
            node.visit_count += 1
            if node.actor == "hr":
                node.total_reward += (1.0 - reward)
            else:
                node.total_reward += reward
            current_id = node.parent_id

    # ------------------------------------------------------------------
    # 树管理
    # ------------------------------------------------------------------

    def _try_merge_static(self, node: MCTSNode):
        """如果 MCTS 节点与静态树节点相似，合并元数据。"""
        if node.action_embedding is None:
            return
        matched_node_id, static_intent, score = self.navigator.match_utterance(
            node.action_embedding, threshold=self.config.merge_threshold,
        )
        if score >= self.config.merge_threshold and matched_node_id is not None:
            static_node = self.navigator.get_node(matched_node_id)
            if static_node:
                node.strategy_tree_node_id = matched_node_id
                # 继承静态树的 risk_level 和话题
                node.risk_level = static_node.get("risk_level", node.risk_level)
                if not node.topic:
                    node.topic = static_node.get("topic", node.topic)

    def _trace_best_path(self, root_id: str, max_depth: int = 3) -> list[dict]:
        """沿着最高访问次数的路径追踪。"""
        path = []
        current = self.nodes.get(root_id)
        for _ in range(max_depth):
            if not current or not current.children:
                break
            child_nodes = [self.nodes[cid] for cid in current.children if cid in self.nodes]
            if not child_nodes:
                break
            best = max(child_nodes, key=lambda n: n.visit_count)
            path.append({
                "action": best.action,
                "actor": best.actor,
                "topic": best.topic,
                "risk_level": best.risk_level,
                "win_rate": round(best.q_value, 3),
            })
            current = best
        return path

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    def _extract_topic(self, text: str, static_node_id: str | None) -> str:
        if static_node_id:
            node = self.navigator.get_node(static_node_id)
            if node:
                return node.get("topic", text[:50])
        return text[:50]

    def _get_highlights(self) -> list:
        fit = self.prep_state.get("fit_report", {})
        return fit.get("highlights", []) if isinstance(fit, dict) else []

    def _get_weak_points(self) -> list:
        profile = self.prep_state.get("profile", {})
        return profile.get("weak_points", [])

    async def _cancel_search(self):
        self._cancel_event.set()
        if self._search_task and not self._search_task.done():
            self._search_task.cancel()
            try:
                await self._search_task
            except (asyncio.CancelledError, Exception):
                pass
            self._search_task = None

    @staticmethod
    def _parse_expansion(raw: str) -> list[dict]:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
        try:
            result = json.loads(text)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            logger.warning(f"MCTS expansion parse failed: {text[:200]}")
        return []
