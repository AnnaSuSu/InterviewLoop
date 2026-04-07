"""MCTS 相关配置和共享数据结构。"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.config import Settings


@dataclass
class MCTSConfig:
    """MCTS 搜索参数配置。"""
    enabled: bool = True
    iterations: int = 8
    branch_factor: int = 3
    rollout_depth: int = 2
    max_expansion_depth: int = 3
    c_puct: float = 1.4
    max_tree_nodes: int = 200
    merge_threshold: float = 0.8
    search_timeout: float = 25.0

    @classmethod
    def from_settings(cls, s: Settings) -> MCTSConfig:
        return cls(
            enabled=s.mcts_enabled,
            iterations=s.mcts_iterations,
            branch_factor=s.mcts_branch_factor,
            rollout_depth=s.mcts_rollout_depth,
            c_puct=s.mcts_c_puct,
            max_tree_nodes=s.mcts_max_tree_nodes,
            merge_threshold=s.mcts_merge_threshold,
            search_timeout=s.mcts_search_timeout,
        )


@dataclass
class MCTSNode:
    """博弈树节点。"""
    id: str
    parent_id: str | None = None
    children: list[str] = field(default_factory=list)

    # 状态
    actor: str = "candidate"  # "candidate" | "hr"
    action: str = ""
    action_embedding: list[float] | None = None

    # 上下文
    topic: str = ""
    conversation_snapshot: list[dict] = field(default_factory=list)

    # MCTS 统计量
    visit_count: int = 0
    total_reward: float = 0.0
    prior: float = 0.5

    # 元数据
    strategy_tree_node_id: str | None = None
    risk_level: str = "safe"
    depth: int = 0

    @property
    def q_value(self) -> float:
        if self.visit_count == 0:
            return 0.0
        return self.total_reward / self.visit_count

    @staticmethod
    def make_id() -> str:
        return uuid.uuid4().hex[:10]


@dataclass
class StrategyRecommendation:
    """MCTS 搜索结果，推送给前端的推荐。"""
    optimal_response_strategy: str = ""
    predicted_followups: list[dict] = field(default_factory=list)
    danger_zones: list[str] = field(default_factory=list)
    win_rate: float = 0.5
    best_path: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    iterations_completed: int = 0
