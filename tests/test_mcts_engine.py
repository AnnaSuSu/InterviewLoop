"""Tests for the MCTS dynamic strategy engine modules.

Covers: mcts_config, reward_model, simulation_engine, mcts_engine.
All tests use deterministic fake embeddings and mocked LLMs — no external
services required.
"""
from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from backend.copilot.mcts_config import MCTSConfig, MCTSNode, StrategyRecommendation
from backend.copilot.reward_model import RewardModel, RewardWeights


# ─────────────────────────── helpers ──────────────────────────────────

class FakeEmbedding:
    """Deterministic embedding: hash text into a fixed-length float vector."""

    def __init__(self, dim: int = 32):
        self.dim = dim

    def get_text_embedding(self, text: str) -> list[float]:
        rng = np.random.RandomState(abs(hash(text)) % (2 ** 31))
        vec = rng.randn(self.dim).astype(np.float32)
        vec /= np.linalg.norm(vec) + 1e-9
        return vec.tolist()


class FakeNavigator:
    """Minimal stand-in for StrategyTreeNavigator."""

    def match_utterance(self, embedding, threshold=0.8):
        return (None, None, 0.0)

    def get_node(self, node_id):
        return {"topic": "fake_topic", "risk_level": "safe"}


_FAKE_EMBED = FakeEmbedding()


def _make_reward_model(
    jd_skills=None, highlights=None, weak_points=None, gaps=None,
) -> RewardModel:
    """Build a RewardModel with pre-injected embeddings (skip async precompute)."""

    jd_analysis = {
        "required_skills": jd_skills or [
            {"skill": "Python", "weight": "core"},
            {"skill": "Kubernetes", "weight": "preferred"},
        ],
    }
    profile = {"weak_points": weak_points or [{"point": "分布式系统经验不足"}]}
    fit = {
        "highlights": highlights or [{"point": "扎实的 Python 工程能力"}],
        "gaps": gaps or [{"point": "缺少大规模数据处理经验"}],
    }

    rm = RewardModel(jd_analysis, profile, fit)

    # Manually populate embedding caches
    for s in jd_analysis["required_skills"]:
        text = s["skill"] if isinstance(s, dict) else str(s)
        w = {"core": 1.0, "preferred": 0.7, "bonus": 0.4}.get(
            s.get("weight", "preferred") if isinstance(s, dict) else "preferred", 0.5,
        )
        emb = np.array(_FAKE_EMBED.get_text_embedding(text), dtype=np.float32)
        rm._jd_skill_embs.append((emb, w))

    for h in fit["highlights"]:
        text = h["point"] if isinstance(h, dict) else str(h)
        rm._safe_embs.append(
            np.array(_FAKE_EMBED.get_text_embedding(text), dtype=np.float32)
        )

    for wp in profile["weak_points"]:
        text = wp["point"] if isinstance(wp, dict) else str(wp)
        rm._danger_embs.append(
            np.array(_FAKE_EMBED.get_text_embedding(text), dtype=np.float32)
        )

    for g in fit["gaps"]:
        text = g["point"] if isinstance(g, dict) else str(g)
        rm._danger_embs.append(
            np.array(_FAKE_EMBED.get_text_embedding(text), dtype=np.float32)
        )

    return rm


# ═══════════════════════════════════════════════════════════════════════
# MCTSConfig
# ═══════════════════════════════════════════════════════════════════════

class TestMCTSConfig:

    def test_defaults(self):
        cfg = MCTSConfig()
        assert cfg.iterations == 8
        assert cfg.c_puct == 1.4
        assert cfg.max_tree_nodes == 200
        assert cfg.search_timeout == 25.0

    def test_from_settings(self):
        mock_s = MagicMock()
        mock_s.mcts_enabled = True
        mock_s.mcts_iterations = 4
        mock_s.mcts_branch_factor = 2
        mock_s.mcts_rollout_depth = 3
        mock_s.mcts_c_puct = 2.0
        mock_s.mcts_max_tree_nodes = 100
        mock_s.mcts_merge_threshold = 0.9
        mock_s.mcts_search_timeout = 15.0

        cfg = MCTSConfig.from_settings(mock_s)
        assert cfg.iterations == 4
        assert cfg.branch_factor == 2
        assert cfg.c_puct == 2.0


# ═══════════════════════════════════════════════════════════════════════
# MCTSNode
# ═══════════════════════════════════════════════════════════════════════

class TestMCTSNode:

    def test_q_value_zero_visits(self):
        node = MCTSNode(id="n1")
        assert node.q_value == 0.0

    def test_q_value_with_visits(self):
        node = MCTSNode(id="n2", visit_count=4, total_reward=2.0)
        assert node.q_value == pytest.approx(0.5)

    def test_make_id_unique(self):
        ids = {MCTSNode.make_id() for _ in range(50)}
        assert len(ids) == 50

    def test_default_fields(self):
        node = MCTSNode(id="t")
        assert node.actor == "candidate"
        assert node.prior == 0.5
        assert node.risk_level == "safe"
        assert node.children == []
        assert node.conversation_snapshot == []


# ═══════════════════════════════════════════════════════════════════════
# StrategyRecommendation
# ═══════════════════════════════════════════════════════════════════════

class TestStrategyRecommendation:

    def test_defaults(self):
        rec = StrategyRecommendation()
        assert rec.win_rate == 0.5
        assert rec.confidence == 0.0
        assert rec.optimal_response_strategy == ""
        assert rec.predicted_followups == []
        assert rec.danger_zones == []


# ═══════════════════════════════════════════════════════════════════════
# RewardModel
# ═══════════════════════════════════════════════════════════════════════

class TestRewardModel:

    def test_evaluate_returns_0_to_1(self):
        rm = _make_reward_model()
        emb = _FAKE_EMBED.get_text_embedding("Python 后端开发")
        node = MCTSNode(id="e1", topic="Python 后端开发", action_embedding=emb)
        score = rm.evaluate(node)
        assert 0.0 <= score <= 1.0

    def test_evaluate_no_embedding_returns_neutral(self):
        rm = _make_reward_model()
        node = MCTSNode(id="e2")  # no topic, no embedding
        with patch("backend.copilot.reward_model.get_embedding", return_value=_FAKE_EMBED):
            score = rm.evaluate(node)
        assert score == pytest.approx(0.3)

    def test_evaluate_uses_action_embedding_first(self):
        rm = _make_reward_model()
        emb = _FAKE_EMBED.get_text_embedding("K8s")
        node = MCTSNode(id="e3", topic="unrelated", action_embedding=emb)
        score = rm.evaluate(node)
        assert 0.0 <= score <= 1.0

    def test_evaluate_falls_back_to_topic(self):
        rm = _make_reward_model()
        node = MCTSNode(id="e4", topic="Kubernetes 部署")
        with patch("backend.copilot.reward_model.get_embedding", return_value=_FAKE_EMBED):
            score = rm.evaluate(node)
        assert 0.0 <= score <= 1.0

    def test_evaluate_path_empty(self):
        rm = _make_reward_model()
        assert rm.evaluate_path([]) == 0.0

    def test_evaluate_path_single_node(self):
        rm = _make_reward_model()
        emb = _FAKE_EMBED.get_text_embedding("Python")
        node = MCTSNode(id="p1", action_embedding=emb)
        val = rm.evaluate_path([node])
        assert val == pytest.approx(rm.evaluate(node))

    def test_evaluate_path_applies_gamma_decay(self):
        rm = _make_reward_model()
        nodes = []
        for i in range(3):
            emb = _FAKE_EMBED.get_text_embedding(f"topic_{i}")
            nodes.append(MCTSNode(id=f"p{i}", action_embedding=emb))
        path_val = rm.evaluate_path(nodes)
        manual = sum(0.9 ** i * rm.evaluate(n) for i, n in enumerate(nodes)) / 3
        assert path_val == pytest.approx(manual)

    def test_cosine_zero_vector(self):
        assert RewardModel._cosine(np.zeros(3), np.ones(3)) == 0.0

    def test_cosine_identical(self):
        v = np.array([1.0, 2.0, 3.0])
        assert RewardModel._cosine(v, v) == pytest.approx(1.0)

    def test_custom_weights(self):
        w = RewardWeights(w_match=1.0, w_safe=0.0, w_risk=0.0)
        rm = _make_reward_model()
        rm.weights = w
        emb = _FAKE_EMBED.get_text_embedding("Python")
        node = MCTSNode(id="w1", action_embedding=emb)
        score = rm.evaluate(node)
        # With only match weight, score equals jd_match clamped to [0,1]
        assert 0.0 <= score <= 1.0

    @pytest.mark.asyncio
    async def test_precompute_embeddings(self):
        rm = RewardModel(
            jd_analysis={"required_skills": [{"skill": "Go", "weight": "core"}]},
            candidate_profile={"weak_points": [{"point": "缺乏经验"}]},
            fit_report={"highlights": [{"point": "算法强"}], "gaps": [{"point": "系统设计弱"}]},
        )
        with patch("backend.copilot.reward_model.get_embedding", return_value=_FAKE_EMBED):
            await rm.precompute_embeddings()
        assert len(rm._jd_skill_embs) == 1
        assert len(rm._safe_embs) == 1
        assert len(rm._danger_embs) == 2  # weak_point + gap


# ═══════════════════════════════════════════════════════════════════════
# SimulationEngine
# ═══════════════════════════════════════════════════════════════════════

class TestSimulationEngine:

    @pytest.mark.asyncio
    async def test_level3_no_llm(self):
        """Without rollout LLM, fallback to pure reward evaluation."""
        from backend.copilot.simulation_engine import SimulationEngine

        rm = _make_reward_model()
        se = SimulationEngine(reward_model=rm, rollout_llm=None)
        emb = _FAKE_EMBED.get_text_embedding("Python")
        node = MCTSNode(id="s1", topic="Python", action_embedding=emb)
        score = await se.rollout(node, {})
        assert score == pytest.approx(rm.evaluate(node))

    @pytest.mark.asyncio
    async def test_llm_rollout_returns_float(self):
        """With a mock LLM, rollout should produce a valid [0,1] score."""
        from backend.copilot.simulation_engine import SimulationEngine

        rm = _make_reward_model()
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = MagicMock(content="使用缓存优化查询")

        se = SimulationEngine(reward_model=rm, rollout_llm=mock_llm, max_rollout_depth=1)
        emb = _FAKE_EMBED.get_text_embedding("数据库优化")
        node = MCTSNode(
            id="s2", topic="数据库优化", action_embedding=emb,
            conversation_snapshot=[{"role": "hr", "text": "讲讲数据库优化"}],
        )
        with patch("backend.copilot.reward_model.get_embedding", return_value=_FAKE_EMBED):
            score = await se.rollout(node, {"highlights": ["SQL 调优经验丰富"]})
        assert 0.0 <= score <= 1.0
        assert mock_llm.ainvoke.call_count == 2  # HR + candidate per depth

    @pytest.mark.asyncio
    async def test_llm_failure_fallback(self):
        """If LLM raises, fallback to pure reward."""
        from backend.copilot.simulation_engine import SimulationEngine

        rm = _make_reward_model()
        mock_llm = AsyncMock()
        mock_llm.ainvoke.side_effect = RuntimeError("api boom")

        se = SimulationEngine(reward_model=rm, rollout_llm=mock_llm)
        emb = _FAKE_EMBED.get_text_embedding("test")
        node = MCTSNode(id="s3", action_embedding=emb)
        score = await se.rollout(node, {})
        assert score == pytest.approx(rm.evaluate(node))


# ═══════════════════════════════════════════════════════════════════════
# MCTSEngine
# ═══════════════════════════════════════════════════════════════════════

class TestMCTSEngine:

    def _make_engine(self, *, iterations=2, branch_factor=2):
        from backend.copilot.mcts_engine import MCTSEngine
        from backend.copilot.simulation_engine import SimulationEngine

        rm = _make_reward_model()
        se = SimulationEngine(reward_model=rm, rollout_llm=None)
        nav = FakeNavigator()
        cfg = MCTSConfig(iterations=iterations, branch_factor=branch_factor, search_timeout=10.0)
        engine = MCTSEngine(
            strategy_navigator=nav,
            reward_model=rm,
            simulation_engine=se,
            prep_state={
                "fit_report": {"highlights": [{"point": "Python 熟练"}]},
                "profile": {"weak_points": [{"point": "系统设计弱"}]},
            },
            config=cfg,
        )
        return engine

    # ── on_hr_utterance ──

    @pytest.mark.asyncio
    async def test_on_hr_utterance_creates_root(self):
        engine = self._make_engine()
        with patch("backend.copilot.mcts_engine.get_embedding", return_value=_FAKE_EMBED):
            await engine.on_hr_utterance("介绍一下你的 Python 经验", None)
        assert engine.root_id is not None
        root = engine.nodes[engine.root_id]
        assert root.actor == "hr"
        assert "Python" in root.action

    @pytest.mark.asyncio
    async def test_on_hr_utterance_resets_tree(self):
        engine = self._make_engine()
        with patch("backend.copilot.mcts_engine.get_embedding", return_value=_FAKE_EMBED):
            await engine.on_hr_utterance("first question", None)
            old_root = engine.root_id
            await engine.on_hr_utterance("second question", None)
        assert engine.root_id != old_root
        assert len(engine.nodes) == 1

    # ── on_candidate_response ──

    @pytest.mark.asyncio
    async def test_on_candidate_response_appends_conversation(self):
        engine = self._make_engine()
        with patch("backend.copilot.mcts_engine.get_embedding", return_value=_FAKE_EMBED):
            await engine.on_hr_utterance("question", None)
        await engine.on_candidate_response("my answer")
        assert any(c["role"] == "candidate" for c in engine._conversation)

    # ── get_recommendation ──

    def test_get_recommendation_empty_tree(self):
        engine = self._make_engine()
        rec = engine.get_recommendation()
        assert isinstance(rec, StrategyRecommendation)
        assert rec.optimal_response_strategy == ""

    def test_get_recommendation_root_only(self):
        engine = self._make_engine()
        root = MCTSNode(id="r", actor="hr", visit_count=3, total_reward=1.5)
        engine.nodes = {"r": root}
        engine.root_id = "r"
        rec = engine.get_recommendation()
        assert rec.win_rate == pytest.approx(0.5)

    def test_get_recommendation_with_children(self):
        engine = self._make_engine()
        root = MCTSNode(id="r", actor="hr", children=["c1", "c2"], visit_count=6)
        c1 = MCTSNode(id="c1", parent_id="r", actor="candidate",
                       action="强调 Python 项目经验", visit_count=4, total_reward=2.8)
        c2 = MCTSNode(id="c2", parent_id="r", actor="candidate",
                       action="承认不足但展示学习", visit_count=2, total_reward=0.6)
        engine.nodes = {"r": root, "c1": c1, "c2": c2}
        engine.root_id = "r"
        rec = engine.get_recommendation()
        assert rec.optimal_response_strategy == "强调 Python 项目经验"
        assert rec.confidence > 0

    # ── _select ──

    def test_select_returns_leaf(self):
        engine = self._make_engine()
        root = MCTSNode(id="r", children=["c1"], visit_count=5)
        c1 = MCTSNode(id="c1", parent_id="r", visit_count=3, total_reward=1.5)
        engine.nodes = {"r": root, "c1": c1}
        leaf = engine._select("r")
        assert leaf.id == "c1"  # c1 is a leaf (no children)

    def test_select_prefers_unvisited(self):
        engine = self._make_engine()
        root = MCTSNode(id="r", children=["c1", "c2"], visit_count=3)
        c1 = MCTSNode(id="c1", parent_id="r", visit_count=3, total_reward=2.0)
        c2 = MCTSNode(id="c2", parent_id="r", visit_count=0, total_reward=0.0)
        engine.nodes = {"r": root, "c1": c1, "c2": c2}
        leaf = engine._select("r")
        assert leaf.id == "c2"

    # ── _backpropagate ──

    def test_backpropagate_updates_path(self):
        engine = self._make_engine()
        root = MCTSNode(id="r", actor="hr", children=["c1"])
        c1 = MCTSNode(id="c1", parent_id="r", actor="candidate")
        engine.nodes = {"r": root, "c1": c1}
        engine._backpropagate("c1", 0.8)
        assert c1.visit_count == 1
        assert c1.total_reward == pytest.approx(0.8)
        assert root.visit_count == 1
        assert root.total_reward == pytest.approx(0.2)  # HR node flips: 1 - 0.8

    def test_backpropagate_hr_flips_reward(self):
        engine = self._make_engine()
        hr_node = MCTSNode(id="h", actor="hr")
        cand_node = MCTSNode(id="c", parent_id="h", actor="candidate")
        engine.nodes = {"h": hr_node, "c": cand_node}
        engine._backpropagate("c", 0.9)
        assert hr_node.total_reward == pytest.approx(0.1)
        assert cand_node.total_reward == pytest.approx(0.9)

    # ── _parse_expansion ──

    def test_parse_expansion_valid_json(self):
        from backend.copilot.mcts_engine import MCTSEngine
        raw = '[{"action":"a","confidence":0.5},{"action":"b","confidence":0.3}]'
        result = MCTSEngine._parse_expansion(raw)
        assert len(result) == 2
        assert result[0]["action"] == "a"

    def test_parse_expansion_markdown_fenced(self):
        from backend.copilot.mcts_engine import MCTSEngine
        raw = '```json\n[{"action":"x","confidence":0.7}]\n```'
        result = MCTSEngine._parse_expansion(raw)
        assert len(result) == 1

    def test_parse_expansion_invalid(self):
        from backend.copilot.mcts_engine import MCTSEngine
        result = MCTSEngine._parse_expansion("not json at all")
        assert result == []

    # ── search (integration) ──

    @pytest.mark.asyncio
    async def test_search_level3_runs(self):
        """Full search loop with Level 3 (no LLM rollout)."""
        engine = self._make_engine(iterations=2, branch_factor=2)
        with patch("backend.copilot.mcts_engine.get_embedding", return_value=_FAKE_EMBED):
            await engine.on_hr_utterance("讲讲你的项目经验", None)

        # Mock expansion LLM
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = MagicMock(
            content=json.dumps([
                {"action": "强调分布式项目", "topic": "分布式", "confidence": 0.6},
                {"action": "介绍性能优化经历", "topic": "性能", "confidence": 0.4},
            ])
        )

        with (
            patch("backend.copilot.mcts_engine.get_copilot_llm", return_value=mock_llm),
            patch("backend.copilot.mcts_engine.get_embedding", return_value=_FAKE_EMBED),
        ):
            await engine.search()

        assert len(engine.nodes) > 1
        rec = engine.get_recommendation()
        assert rec.optimal_response_strategy != ""
        assert 0.0 <= rec.win_rate <= 1.0

    # ── stop ──

    @pytest.mark.asyncio
    async def test_stop_is_safe(self):
        engine = self._make_engine()
        await engine.stop()  # should not raise


# ═══════════════════════════════════════════════════════════════════════
# Settings integration
# ═══════════════════════════════════════════════════════════════════════

class TestSettingsIntegration:

    def test_mcts_settings_exist(self):
        from backend.config import settings
        assert hasattr(settings, "mcts_enabled")
        assert hasattr(settings, "mcts_iterations")
        assert hasattr(settings, "mcts_c_puct")

    def test_mcts_disabled_by_default(self):
        from backend.config import settings
        assert settings.mcts_enabled is False

    def test_get_mcts_rollout_llm_returns_none_by_default(self):
        from backend.llm_provider import get_mcts_rollout_llm
        result = get_mcts_rollout_llm()
        assert result is None
