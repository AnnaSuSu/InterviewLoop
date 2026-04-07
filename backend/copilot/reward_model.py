"""Reward Model — 对面试状态进行快速打分。

核心公式: R(S) = W1·Match_JD + W2·Safe_candidate - W3·Risk_danger
设计目标: 单次评估 < 10ms（纯向量运算，不调 LLM）。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from backend.llm_provider import get_embedding
from backend.copilot.mcts_config import MCTSNode

logger = logging.getLogger("uvicorn")

# JD skill weight → numeric multiplier
_WEIGHT_MAP = {"core": 1.0, "preferred": 0.7, "bonus": 0.4}


@dataclass
class RewardWeights:
    w_match: float = 0.4
    w_safe: float = 0.35
    w_risk: float = 0.25


class RewardModel:
    """面试状态奖励评估器。"""

    def __init__(
        self,
        jd_analysis: dict,
        candidate_profile: dict,
        fit_report: dict,
        weights: RewardWeights | None = None,
    ):
        self.jd_analysis = jd_analysis
        self.candidate_profile = candidate_profile
        self.fit_report = fit_report
        self.weights = weights or RewardWeights()

        # 预计算缓存
        self._jd_skill_embs: list[tuple[np.ndarray, float]] = []  # (emb, weight_multiplier)
        self._safe_embs: list[np.ndarray] = []
        self._danger_embs: list[np.ndarray] = []

    # ------------------------------------------------------------------
    # 预计算
    # ------------------------------------------------------------------

    async def precompute_embeddings(self):
        embed = get_embedding()

        # JD skills
        skills = self.jd_analysis.get("required_skills", [])
        for s in skills:
            text = s.get("skill", "") if isinstance(s, dict) else str(s)
            if not text:
                continue
            weight_key = s.get("weight", "preferred") if isinstance(s, dict) else "preferred"
            mult = _WEIGHT_MAP.get(weight_key, 0.5)
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._jd_skill_embs.append((emb, mult))
            except Exception as e:
                logger.warning(f"RewardModel: JD embed failed for '{text[:30]}': {e}")

        # dimensions as extra JD signals
        dims = self.jd_analysis.get("likely_question_dimensions", [])
        for d in dims:
            text = d.get("dimension", "") if isinstance(d, dict) else str(d)
            if not text:
                continue
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._jd_skill_embs.append((emb, 0.6))
            except Exception:
                pass

        # Safe zones — highlights from fit report
        highlights = self.fit_report.get("highlights", []) if isinstance(self.fit_report, dict) else []
        for h in highlights:
            text = h.get("point", str(h)) if isinstance(h, dict) else str(h)
            if not text:
                continue
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._safe_embs.append(emb)
            except Exception:
                pass

        # strong points from profile
        for sp in self.candidate_profile.get("strong_points", []):
            text = sp.get("point", str(sp)) if isinstance(sp, dict) else str(sp)
            if not text:
                continue
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._safe_embs.append(emb)
            except Exception:
                pass

        # Danger zones — weak points + gaps
        for wp in self.candidate_profile.get("weak_points", []):
            text = wp.get("point", str(wp)) if isinstance(wp, dict) else str(wp)
            if not text:
                continue
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._danger_embs.append(emb)
            except Exception:
                pass

        gaps = self.fit_report.get("gaps", []) if isinstance(self.fit_report, dict) else []
        for g in gaps:
            text = g.get("point", str(g)) if isinstance(g, dict) else str(g)
            if not text:
                continue
            try:
                emb = np.array(embed.get_text_embedding(text), dtype=np.float32)
                self._danger_embs.append(emb)
            except Exception:
                pass

        logger.info(
            f"RewardModel precomputed: jd={len(self._jd_skill_embs)} "
            f"safe={len(self._safe_embs)} danger={len(self._danger_embs)}"
        )

    # ------------------------------------------------------------------
    # 评估
    # ------------------------------------------------------------------

    def evaluate(self, node: MCTSNode) -> float:
        """对一个节点打分，返回 [0, 1]。"""
        topic_emb = self._get_topic_embedding(node)
        if topic_emb is None:
            return 0.3  # 无法评估时给中性分

        match_score = self._calc_jd_match(topic_emb)
        safe_score = self._calc_safety(topic_emb)
        risk_score = self._calc_risk(topic_emb)

        reward = (
            self.weights.w_match * match_score
            + self.weights.w_safe * safe_score
            - self.weights.w_risk * risk_score
        )
        return max(0.0, min(1.0, reward))

    def evaluate_path(self, path: list[MCTSNode]) -> float:
        """带衰减的路径累积奖励。"""
        if not path:
            return 0.0
        gamma = 0.9
        total = 0.0
        for i, node in enumerate(path):
            total += (gamma ** i) * self.evaluate(node)
        return total / len(path)

    # ------------------------------------------------------------------
    # 内部计算
    # ------------------------------------------------------------------

    def _get_topic_embedding(self, node: MCTSNode) -> np.ndarray | None:
        if node.action_embedding is not None:
            return np.array(node.action_embedding, dtype=np.float32)
        if node.topic:
            try:
                emb = get_embedding().get_text_embedding(node.topic)
                return np.array(emb, dtype=np.float32)
            except Exception:
                pass
        return None

    def _calc_jd_match(self, topic_emb: np.ndarray) -> float:
        if not self._jd_skill_embs:
            return 0.5
        best = 0.0
        for emb, mult in self._jd_skill_embs:
            sim = self._cosine(topic_emb, emb)
            score = sim * mult
            if score > best:
                best = score
        return min(1.0, best)

    def _calc_safety(self, topic_emb: np.ndarray) -> float:
        if not self._safe_embs:
            return 0.5
        return max(self._cosine(topic_emb, e) for e in self._safe_embs)

    def _calc_risk(self, topic_emb: np.ndarray) -> float:
        if not self._danger_embs:
            return 0.0
        return max(self._cosine(topic_emb, e) for e in self._danger_embs)

    @staticmethod
    def _cosine(a: np.ndarray, b: np.ndarray) -> float:
        na = np.linalg.norm(a)
        nb = np.linalg.norm(b)
        if na == 0 or nb == 0:
            return 0.0
        return float(np.clip(np.dot(a, b) / (na * nb), 0.0, 1.0))
