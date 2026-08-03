"""个性化记忆系统 — 跨面试用户画像。

设计哲学：
- 文件即真相（OpenClaw）：profile.json 可人工编辑
- 两阶段提取（Mem0）：Extract → Update，不无脑追加
- 向量召回（embedding）：语义搜索历史洞察
"""
import asyncio
import copy
import json
import logging
import math
import re
import os
import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np
from langchain_core.messages import SystemMessage, HumanMessage

from backend.config import settings
from backend.llm_provider import get_langchain_llm

logger = logging.getLogger("uvicorn")

# Strip "(领域：xxx)" suffix that LLM sometimes copies from format hints
_TOPIC_SUFFIX_RE = re.compile(r'\s*[（(]领域[：:]\s*[^）)]+[）)]\s*$')

# 表现轴的四个固定 namespace。这一层是认知架构分类(怎么表达/怎么想/怎么叙事/对自己怎么评),
# 是封闭集合,LLM 自由度花在 namespace 之下的 behavior_id 涌现,不放在创造新 namespace 上。
BEHAVIOR_NAMESPACES = {"reasoning", "narrative", "communication", "metacognition"}

# behavior_signal ID 格式: <namespace>.<snake_case_name>
_BEHAVIOR_ID_RE = re.compile(r'^([a-z_]+)\.([a-z][a-z0-9_]*)$')


def _clean_point_text(text: str) -> str:
    return _TOPIC_SUFFIX_RE.sub('', text).strip()


def _get_canonical_topic_keys(user_id: str) -> set[str]:
    from backend.indexer import load_topics
    return set(load_topics(user_id).keys())


def _normalize_extraction_topics(extraction: dict, canonical: set, fallback_topic: str):
    """Normalize topic for knowledge-axis weak/strong points.

    weak_points 和 strong_points 现在只承载知识轴。topic 必须在 canonical 集合内,
    否则 fallback 到当前面试的 topic。表现轴观察走 behavior_signals,不进这两个数组。
    """
    for item in extraction.get("weak_points", []) + extraction.get("strong_points", []):
        if not isinstance(item, dict):
            continue
        item["point"] = _clean_point_text(item.get("point", ""))
        item.pop("axis", None)  # 旧字段,新数据不带
        topic = item.get("topic", "")
        if topic not in canonical:
            item["topic"] = fallback_topic


# Per-user locks to prevent concurrent read-modify-write on profile.json
_profile_locks: dict[str, asyncio.Lock] = {}


def _get_profile_lock(user_id: str) -> asyncio.Lock:
    if user_id not in _profile_locks:
        _profile_locks[user_id] = asyncio.Lock()
    return _profile_locks[user_id]

# ── Profile Schema ──

DEFAULT_PROFILE = {
    "name": "",
    "target_role": "",
    "updated_at": "",

    # 上次 consolidation 运行时间 (用于节流,避免每次 session 都跑 Stage 3)
    "last_consolidation_at": "",

    # 技术掌握度 (topic → {level: 1-5, notes: str})
    "topic_mastery": {},

    # 知识轴薄弱点 (list of {point, topic, first_seen, last_seen, times_seen, improved})
    "weak_points": [],

    # 知识轴强项 (list of {point, topic, first_seen})
    "strong_points": [],

    # 表现轴: behavior_signals.
    # key 是 emergent ID (格式 <namespace>.<snake_case>),value 是该模式的累积证据.
    # 与 weak_points / strong_points 物理分离,不嵌套. polarity 决定它是负向还是正向.
    # 示例: "reasoning.jump_to_conclusion": {
    #     "namespace": "reasoning",
    #     "polarity": "negative",
    #     "description": "被追问 why 时跳过推导直接给结论",
    #     "first_seen": "...", "last_seen": "...", "times_seen": 3,
    #     "improved": false,
    #     "examples": [{"session_id": "...", "date": "...", "snippet": "..."}]
    # }
    "behavior_signals": {},

    # legacy 表现轴 (已停写,只读)。表现类观察统一走 behavior_signals;
    # 这两个字段只为老用户的存量数据保留,新数据不再写入。
    "communication": {
        "style": "",
        "habits": [],
        "suggestions": [],
    },
    "thinking_patterns": {
        "strengths": [],
        "gaps": [],
    },

    # 面试统计
    "stats": {
        "total_sessions": 0,
        "resume_sessions": 0,
        "drill_sessions": 0,
        "job_prep_sessions": 0,
        "avg_score": 0,
        "score_history": [],  # [{date, mode, topic, avg_score}]
    },
}

EXTRACT_PROMPT = """你是一个面试教练的分析引擎。根据面试对话记录，提取关于候选人的结构化洞察。

## 候选人当前画像
{current_profile}

## 候选人已有的 behavior_signals（优先复用这些 ID，不要起新名字除非真的不同）
{existing_behavior_signals}

## 本次面试记录
模式: {mode}
领域: {topic}
{transcript}

## 评分记录（如有）
{scores}

## 合法领域列表
{allowed_topics}

## 画像的两条独立轴（物理分离，不嵌套）

### 知识轴 → weak_points / strong_points
针对具体技术领域的知识掌握情况。每条带 topic，topic 必须从「合法领域列表」选。
观察的是"懂不懂、会不会"，**不**涉及"怎么表达、怎么思考"。
不属于具体领域时，使用本次面试的领域 "{topic}"。

### 表现轴 → behavior_signals（一组 op）
独立于知识轴，描述候选人作为面试者的行为模式。
四个 namespace（**锁定，不可创新**）：
- reasoning：推导/思维方式（被追问 why 时如何应对、能否从底层推导、是否跳步）
- narrative：项目叙事（讲项目的结构、量化指标、技术权衡是否讲清）
- communication：表达特征（节奏、结构信号、清晰度、口头禅）
- metacognition：元认知（自我评估准确性、对自己弱点的觉察、不懂装懂）

每个 behavior_signal 是一个操作 op：
- **ADD**：全新模式。创建新 ID，格式严格为 `<namespace>.<snake_case_name>`。必须给 polarity（negative|positive）+ description（一句话锚定语义，后续不可覆盖）+ snippet（本次具体证据）
- **UPDATE**：复用上面"已有 behavior_signals"中的 ID。只给 snippet（本次新证据）
- **IMPROVE**：已有 negative 模式在本次出现了反向证据。给 evidence_snippet（说明为什么这次是反例）
- **NOOP**：不输出

ID 复用优先级最高：能用已有 ID 就**绝对不要**起新 ID。新 ID 只在所有现有 ID 都无法覆盖时才创建。
namespace 必须在四个里选，不要造新 namespace。
宁可不输出，不要凑数。

## 任务
分析这次面试，返回 JSON：

```json
{{
    "weak_points": [
        {{"point": "对 Python GIL 的理解停留在表面", "topic": "python"}}
    ],
    "strong_points": [
        {{"point": "RAG 架构描述清晰，有实战数据支撑", "topic": "rag"}}
    ],
    "behavior_signals": [
        {{
            "action": "ADD",
            "id": "reasoning.jump_to_conclusion",
            "namespace": "reasoning",
            "polarity": "negative",
            "description": "被追问 why 时跳过推导过程，直接给结论",
            "snippet": "讲为什么用 RAG 而非微调时直接说'更省钱'就停了"
        }},
        {{
            "action": "UPDATE",
            "id": "narrative.lack_metrics",
            "snippet": "讲 RAG 项目时没有任何数字指标"
        }},
        {{
            "action": "IMPROVE",
            "id": "communication.overlong_answer",
            "evidence_snippet": "本次答题平均不超过 90 秒，比之前简洁"
        }}
    ],
    "topic_mastery": {{
        "python": {{"notes": "基础扎实但高级特性（元类、描述符）薄弱"}}
    }},
    "session_summary": "本次 Python 专项训练，基础题表现好，但 GIL 和 GC 机制理解不够深入",
    "dimension_scores": {{
        "technical_depth": 6,
        "project_articulation": 7,
        "communication": 5,
        "problem_solving": 6
    }},
    "avg_score": 6.0
}}
```

## dimension_scores 评分说明（仅简历面试模式需要填写，专项训练留空即可）
- technical_depth (1-10): 技术理解的深度，是真懂还是在背？
- project_articulation (1-10): 项目描述能力——设计思路、量化成果、技术权衡是否讲清楚
- communication (1-10): 表达的清晰度、结构化程度、简洁性
- problem_solving (1-10): 被追问时的分析推理能力
- avg_score = 四个维度的均值，保留一位小数

规则：
- 只提取本次面试中明确暴露的信息，不要猜测
- 知识类观察只放 weak_points / strong_points；表达/思维/叙事/元认知**只放 behavior_signals**，不要另立字段
- weak_points / strong_points 的 topic 必须在「合法领域列表」内，禁止自创领域
- topic_mastery 只需提供 notes，score 由算法计算
- 专项训练模式下 dimension_scores 可省略，只需给 avg_score
"""


# ── Per-user path helpers ──

def _profile_path(user_id: str) -> Path:
    return settings.user_profile_dir(user_id) / "profile.json"


def _insights_dir(user_id: str) -> Path:
    return settings.user_profile_dir(user_id) / "insights"


def _load_profile(user_id: str) -> dict:
    path = _profile_path(user_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    # deepcopy: 浅拷贝会让所有新用户共享嵌套 list/dict，写入互相污染
    return copy.deepcopy(DEFAULT_PROFILE)


def _save_profile(profile: dict, user_id: str):
    path = _profile_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    profile["updated_at"] = datetime.now().isoformat()

    temp_path = None
    try:
        # 临时文件必须和目标文件位于同一目录，确保 os.replace 是原子的
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)

            json.dump(
                profile,
                temp_file,
                ensure_ascii=False,
                indent=2,
            )
            temp_file.flush()
            os.fsync(temp_file.fileno())

        # Windows 下必须先关闭临时文件，再替换目标文件
        os.replace(temp_path, path)
        temp_path = None  # 成功后置空

    finally:
        # 替换失败时清理临时文件；成功时文件已不存在
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _save_insight(mode: str, topic: str, summary: str, raw_extraction: dict, user_id: str):
    """Append daily insight file (OpenClaw-style daily log)."""
    ins_dir = _insights_dir(user_id)
    ins_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    path = ins_dir / f"{today}.md"

    time_str = datetime.now().strftime("%H:%M")
    entry = f"\n## {time_str} | {mode} | {topic or '综合'}\n\n{summary}\n"

    if raw_extraction.get("weak_points"):
        entry += "\n**薄弱点:**\n"
        for wp in raw_extraction["weak_points"]:
            entry += f"- {wp['point']} ({wp.get('topic', '')})\n"

    if raw_extraction.get("strong_points"):
        entry += "\n**亮点:**\n"
        for sp in raw_extraction["strong_points"]:
            entry += f"- {sp['point']} ({sp.get('topic', '')})\n"

    entry += "\n---\n"

    with open(path, "a", encoding="utf-8") as f:
        f.write(entry)


def get_profile(user_id: str) -> dict:
    return _load_profile(user_id)


async def mark_profile_viewed(user_id: str) -> dict:
    """记录画像页访问基线快照，前端据此派生"自上次访问"的 delta 视图。

    快照存 total_sessions 和各 topic 当时的掌握度，使 mastery 变化可以精确计算
    （score_history 只有 session 均分，推不出掌握度差值）。
    """
    async with _get_profile_lock(user_id):
        profile = _load_profile(user_id)
        marker = {
            "at": datetime.now().isoformat(),
            "total_sessions": profile.get("stats", {}).get("total_sessions", 0),
            "topic_scores": {
                t: v.get("score", v.get("level", 0) * 20)
                for t, v in profile.get("topic_mastery", {}).items()
            },
        }
        profile["view_marker"] = marker
        _save_profile(profile, user_id)
        return marker


async def update_target_role(user_id: str, target_role: str) -> None:
    """Persist target_role as the sticky default for future sessions."""
    target_role = (target_role or "").strip()
    if not target_role:
        return
    async with _get_profile_lock(user_id):
        profile = _load_profile(user_id)
        if profile.get("target_role") == target_role:
            return
        profile["target_role"] = target_role
        _save_profile(profile, user_id)


# Weak-point salience decay: rank active weak points by recency × frequency so a
# point not re-exposed in training gradually sinks instead of being hard-cut at a
# fixed age cliff. Pure ranking signal — never persisted. HALF_LIFE ≈ idle days that
# halve salience; repeated occurrences slow the sink (capped at +2×).
WEAK_POINT_HALF_LIFE_DAYS = 30


def _weak_point_weight(wp: dict, now: datetime) -> float:
    last_seen = wp.get("last_seen") or wp.get("first_seen") or ""
    try:
        days = max(0.0, (now - datetime.fromisoformat(last_seen)).total_seconds() / 86400)
    except (ValueError, TypeError):
        days = 0.0  # missing/bad timestamp → treat as fresh, don't penalize
    recency = 0.5 ** (days / WEAK_POINT_HALF_LIFE_DAYS)
    times_seen = wp.get("times_seen", 1) or 1
    freq_mult = 1.0 + min(math.log2(times_seen), 2.0)
    return recency * freq_mult


def get_topic_score_trend(profile: dict, topic: str, window: int = 5) -> dict | None:
    """近 N 次该领域训练的均分趋势，从 score_history 派生，零额外存储。

    至少 2 次有分记录才有趋势。direction 阈值 ±0.5 分，避免噪声当趋势。
    """
    scores = [
        h["avg_score"] for h in profile.get("stats", {}).get("score_history", [])
        if h.get("topic") == topic and isinstance(h.get("avg_score"), (int, float))
    ][-window:]
    if len(scores) < 2:
        return None
    delta = round(scores[-1] - scores[0], 1)
    direction = "up" if delta >= 0.5 else "down" if delta <= -0.5 else "flat"
    return {
        "scores": scores,
        "first": scores[0],
        "last": scores[-1],
        "delta": delta,
        "direction": direction,
    }


def get_topic_context_for_drill(topic: str, user_id: str) -> dict:
    """Get personalized context for drill question generation."""
    profile = _load_profile(user_id)

    mastery = profile.get("topic_mastery", {}).get(topic, {})
    mastery_score = mastery.get("score", mastery.get("level", 0) * 20)
    mastery_notes = mastery.get("notes", "新领域，暂无历史数据" if mastery_score == 0 else "")
    mastery_info = f"{mastery_score}/100 — {mastery_notes}"

    trend = get_topic_score_trend(profile, topic)
    if trend:
        arrow = {"up": "↗", "down": "↘", "flat": "→"}[trend["direction"]]
        mastery_info += (
            f"；近 {len(trend['scores'])} 次训练均分 {trend['first']} → {trend['last']} {arrow}"
        )

    # Weak points for this topic (knowledge only — legacy axis=performance excluded),
    # most salient first via recency×frequency decay.
    now = datetime.now()
    topic_weak_wps = [
        w for w in profile.get("weak_points", [])
        if w.get("topic") == topic
        and not w.get("improved")
        and not w.get("archived")
        and w.get("axis") != "performance"
    ]
    topic_weak_wps.sort(key=lambda w: _weak_point_weight(w, now), reverse=True)
    topic_weak = [w["point"] for w in topic_weak_wps]

    # Recent questions asked in this topic — anti-repeat context for generation.
    # score_history 从不存题目文本,必须从 sessions 存储读,否则永远为空。
    from backend.storage.sessions import list_recent_questions
    recent_questions = list_recent_questions(topic, user_id=user_id)

    # Semantic retrieval of past insights for this topic
    past_insights = []
    try:
        from backend.vector_memory import search_memory
        results = search_memory(
            query=f"{topic} 面试薄弱点 常见错误",
            chunk_types=["session_summary", "insight"],
            topic=topic,
            user_id=user_id,
            top_k=3,
        )
        past_insights = [r["content"] for r in results if r["score"] > 0.3]
    except Exception:
        pass  # vector table may not exist yet

    return {
        "mastery_info": mastery_info,
        "mastery_score": mastery_score,
        "trend": trend,
        "weak_points": topic_weak,
        "recent_questions": recent_questions,
        "past_insights": past_insights,
    }


def _active_knowledge_weak_points(profile: dict) -> list[dict]:
    """Knowledge-axis weak points only. Filters out improved, archived, and legacy axis=performance."""
    return [
        w for w in profile.get("weak_points", [])
        if not w.get("improved")
        and not w.get("archived")
        and w.get("axis") != "performance"  # 老数据可能带 axis=performance,排除
    ]


def _top_consolidated_patterns(profile: dict, limit: int = 3) -> list[str]:
    """Active consolidated cross-domain patterns, highest confidence first.

    Stage 3 产出的规律 source="consolidated"，不在 observed/predicted 两个过滤里，
    必须显式取出注入 prompt，否则只写不读。
    """
    patterns = [
        w for w in profile.get("weak_points", [])
        if w.get("source") == "consolidated" and not w.get("improved") and not w.get("archived")
    ]
    patterns.sort(
        key=lambda w: (w.get("confidence", 0.7), w.get("last_seen", "")),
        reverse=True,
    )
    return [w["point"] for w in patterns[:limit]]


def _top_behavior_signals(profile: dict, polarity: str | None = None, limit: int = 6) -> list[tuple[str, dict]]:
    """Top behavior_signals sorted by recency × times_seen.

    复用 _weak_point_weight 的半衰期权重（字段同构: last_seen/first_seen/times_seen）。
    纯按 times_seen 排会让几个月前的旧高频信号永远压住最近的新信号。

    polarity=None returns all (active negatives + improved positives).
    polarity="negative" returns active negative signals only.
    """
    signals = profile.get("behavior_signals", {}) or {}
    items = []
    for sid, data in signals.items():
        if data.get("improved"):
            continue  # 改善了暂不进 summary
        if polarity and data.get("polarity", "negative") != polarity:
            continue
        items.append((sid, data))

    now = datetime.now()
    items.sort(key=lambda pair: _weak_point_weight(pair[1], now), reverse=True)
    return items[:limit]


def _legacy_observation_lines(profile: dict) -> list[str]:
    """Legacy communication/thinking_patterns 注入行。

    这两个字段已停止写入(表现轴统一走 behavior_signals),只对老用户的存量数据
    做 prompt 注入兜底;一旦该用户已有 behavior_signals,就不再重复注入同轴信息。
    """
    if profile.get("behavior_signals"):
        return []
    parts = []
    if profile.get("communication", {}).get("style"):
        parts.append(f"沟通风格: {profile['communication']['style']}")
    tp = profile.get("thinking_patterns", {})
    if tp.get("gaps"):
        parts.append(f"思维短板: {', '.join(tp['gaps'][:5])}")
    if tp.get("strengths"):
        parts.append(f"思维优势: {', '.join(tp['strengths'][:5])}")
    return parts


def get_profile_summary(user_id: str) -> str:
    """Generate a concise summary for injection into interviewer prompts."""
    profile = _load_profile(user_id)

    parts = []
    active_weak = _active_knowledge_weak_points(profile)
    if active_weak:
        now = datetime.now()
        observed_wps = sorted(
            (w for w in active_weak if w.get("source", "observed") == "observed"),
            key=lambda w: _weak_point_weight(w, now),
            reverse=True,
        )
        observed = [w["point"] for w in observed_wps[:6]]
        predicted = [w["point"] for w in active_weak if w.get("source") == "predicted"][:4]
        if observed:
            parts.append(f"已知知识薄弱点（训练中暴露）: {', '.join(observed)}")
        if predicted:
            parts.append(f"潜在知识薄弱点（JD分析预测）: {', '.join(predicted)}")

    consolidated = _top_consolidated_patterns(profile)
    if consolidated:
        parts.append("跨领域规律（系统从多次训练归纳）:\n  - " + "\n  - ".join(consolidated))

    if profile.get("strong_points"):
        # 按时间倒序: 列表是插入序,直接 [:5] 永远只注入最早的几条
        recent_strong = sorted(
            profile["strong_points"],
            key=lambda s: s.get("first_seen", ""),
            reverse=True,
        )
        points = ", ".join(s["point"] for s in recent_strong[:5])
        parts.append(f"知识强项: {points}")

    # 表现轴:行为模式
    top_behaviors = _top_behavior_signals(profile, polarity="negative", limit=6)
    if top_behaviors:
        lines = [
            f"{sid} (出现 {data.get('times_seen', 1)} 次): {(data.get('description') or '').strip()}"
            for sid, data in top_behaviors
        ]
        parts.append("行为模式短板:\n  - " + "\n  - ".join(lines))

    parts.extend(_legacy_observation_lines(profile))

    if profile.get("stats", {}).get("total_sessions"):
        stats = profile["stats"]
        parts.append(f"已完成 {stats['total_sessions']} 次模拟面试")

    if profile.get("topic_mastery"):
        mastery = ", ".join(
            f"{t}: {v.get('score', v.get('level', 0) * 20)}/100"
            for t, v in profile["topic_mastery"].items()
        )
        parts.append(f"掌握度: {mastery}")

    return "\n".join(parts) if parts else "新用户，暂无历史数据"


def get_profile_summary_for_drill(user_id: str) -> str:
    """Concise summary for drill question generation — only cross-topic info."""
    profile = _load_profile(user_id)
    parts = []

    # consolidated patterns 和 behavior_signals 都是天然跨 topic 的,直接注入 top N
    consolidated = _top_consolidated_patterns(profile)
    if consolidated:
        parts.append("跨领域规律（系统从多次训练归纳）:\n  - " + "\n  - ".join(consolidated))

    top_behaviors = _top_behavior_signals(profile, polarity="negative", limit=3)
    if top_behaviors:
        lines = [
            f"{sid}: {(data.get('description') or '').strip()}"
            for sid, data in top_behaviors
        ]
        parts.append("反复出现的行为模式短板:\n  - " + "\n  - ".join(lines))

    parts.extend(_legacy_observation_lines(profile))

    if profile.get("stats", {}).get("total_sessions"):
        parts.append(f"已完成 {profile['stats']['total_sessions']} 次模拟面试")

    return "\n".join(parts) if parts else "新用户，暂无历史数据"


def _compact_profile_for_extract(profile: dict) -> str:
    """Stage 1 Extract prompt 的紧凑画像视图。

    全量 json.dumps(profile) 会把 archived 条目、整个 score_history、behavior
    examples 全部塞进 prompt，随使用量无界膨胀，且旧数据会锚定 LLM。
    只注入活跃子集；behavior_signals 不在这里——prompt 有独立的
    existing_behavior_signals 区块。
    """
    parts = []
    if profile.get("target_role"):
        parts.append(f"目标岗位: {profile['target_role']}")

    now = datetime.now()
    active_weak = _active_knowledge_weak_points(profile)
    observed = sorted(
        (w for w in active_weak if w.get("source", "observed") == "observed"),
        key=lambda w: _weak_point_weight(w, now),
        reverse=True,
    )[:10]
    if observed:
        lines = [
            f"- {w['point']} (领域: {w.get('topic', '?')}, 出现 {w.get('times_seen', 1)} 次)"
            for w in observed
        ]
        parts.append("活跃知识薄弱点:\n" + "\n".join(lines))

    consolidated = _top_consolidated_patterns(profile)
    if consolidated:
        parts.append("跨领域规律:\n" + "\n".join(f"- {p}" for p in consolidated))

    if profile.get("strong_points"):
        recent_strong = sorted(
            profile["strong_points"],
            key=lambda s: s.get("first_seen", ""),
            reverse=True,
        )[:5]
        parts.append("知识强项: " + ", ".join(s["point"] for s in recent_strong))

    if profile.get("topic_mastery"):
        lines = []
        for t, v in profile["topic_mastery"].items():
            score = v.get("score", v.get("level", 0) * 20)
            notes = (v.get("notes") or "")[:50]
            lines.append(f"- {t}: {score}/100" + (f" — {notes}" if notes else ""))
        parts.append("领域掌握度:\n" + "\n".join(lines))

    parts.extend(_legacy_observation_lines(profile))

    stats = profile.get("stats", {})
    if stats.get("total_sessions"):
        parts.append(f"已完成 {stats['total_sessions']} 次训练, 综合平均分 {stats.get('avg_score', '?')}")

    return "\n\n".join(parts) if parts else "新用户，暂无历史画像"


# ── Mem0-style LLM profile update ──

from backend.utils import parse_json_response as _parse_json_safe  # noqa: E402


def _apply_behavior_ops(profile: dict, ops: list, session_id: str | None, now: str) -> dict:
    """Apply mem0-style ops to behavior_signals dict.

    Supported actions (Stage 2 only, no MERGE here):
    - ADD: create new entry. Requires id / namespace / polarity / description.
           If id already exists, fall through to UPDATE.
    - UPDATE: bump times_seen, append example, refresh last_seen.
              If the signal was marked improved, flip it back and record regression.
    - IMPROVE: mark existing negative signal as improved with evidence.
    - NOOP / unknown / missing existing: silently skipped.

    Validation:
    - id must match <namespace>.<snake_case>
    - namespace must be in BEHAVIOR_NAMESPACES
    - Invalid ops are logged and dropped (no silent default routing)

    Returns a tally dict for logging (added / updated / improved / rejected).
    """
    tally = {"added": 0, "updated": 0, "improved": 0, "rejected": 0, "noop": 0}
    if not ops:
        return tally

    signals = profile.setdefault("behavior_signals", {})

    for op in ops:
        if not isinstance(op, dict):
            tally["rejected"] += 1
            continue

        action = (op.get("action") or "").upper()
        if action == "NOOP":
            tally["noop"] += 1
            continue

        signal_id = (op.get("id") or "").strip()
        m = _BEHAVIOR_ID_RE.match(signal_id)
        if not m:
            logger.warning(f"behavior op rejected: bad id {signal_id!r}")
            tally["rejected"] += 1
            continue

        namespace = m.group(1)
        if namespace not in BEHAVIOR_NAMESPACES:
            logger.warning(
                f"behavior op rejected: namespace {namespace!r} not in {BEHAVIOR_NAMESPACES}"
            )
            tally["rejected"] += 1
            continue

        existing = signals.get(signal_id)

        if action == "ADD" and existing is None:
            polarity = op.get("polarity", "negative")
            if polarity not in ("negative", "positive"):
                polarity = "negative"
            entry = {
                "namespace": namespace,
                "polarity": polarity,
                "description": (op.get("description") or "").strip(),
                "first_seen": now,
                "last_seen": now,
                "times_seen": 1,
                "improved": False,
                "examples": [],
            }
            snippet = (op.get("snippet") or "").strip()
            if snippet:
                entry["examples"].append({
                    "session_id": session_id,
                    "date": now,
                    "snippet": snippet,
                })
            signals[signal_id] = entry
            tally["added"] += 1

        elif action in ("ADD", "UPDATE") and existing is not None:
            # ADD on existing id is degraded to UPDATE
            existing["times_seen"] = existing.get("times_seen", 0) + 1
            existing["last_seen"] = now
            snippet = (op.get("snippet") or "").strip()
            if existing.get("improved"):
                existing["improved"] = False
                regressed_event = {"date": now, "event": "regressed"}
                if snippet:
                    regressed_event["evidence"] = snippet
                existing.setdefault("history", []).append(regressed_event)
            if snippet:
                examples = existing.setdefault("examples", [])
                examples.append({
                    "session_id": session_id,
                    "date": now,
                    "snippet": snippet,
                })
                if len(examples) > 5:
                    existing["examples"] = examples[-5:]
            tally["updated"] += 1

        elif action == "IMPROVE" and existing is not None:
            existing["improved"] = True
            existing["improved_at"] = now
            existing.setdefault("history", []).append({
                "date": now,
                "event": "improved",
                "evidence": (op.get("evidence_snippet") or "").strip(),
            })
            tally["improved"] += 1

        else:
            # UPDATE/IMPROVE on missing id, or unknown action
            tally["rejected"] += 1

    return tally


def _regress_if_improved(wp: dict, now: str, evidence: str = "") -> bool:
    """Flip a previously-improved weak point back to active when it resurfaces.

    Knowledge gaps were one-way latched (improved could never revert), unlike
    behavior_signals. This mirrors that regression path: a "fixed" gap observed
    again is no longer fixed. Returns True if a regression was recorded.
    """
    if not wp.get("improved"):
        return False
    wp["improved"] = False
    event = {"date": now, "event": "regressed"}
    if evidence:
        event["evidence"] = evidence
    wp.setdefault("history", []).append(event)
    return True


def _apply_memory_ops(profile: dict, ops: dict, topic: str | None, now: str, user_id: str = "",
                      new_weak_points: list | None = None, new_strong_points: list | None = None):
    """Execute LLM-decided ADD/UPDATE/NOOP/IMPROVE operations on profile.

    Topic for ADD ops comes from Stage 1 extraction (new_weak_points/new_strong_points),
    not from Stage 2 LLM output, to prevent topic hallucination.
    """
    from backend.vector_memory import upsert_weak_point_vector

    weak_points = profile.setdefault("weak_points", [])

    for i, op in enumerate(ops.get("weak_point_ops", [])):
        action = op.get("action", "NOOP")
        if action == "ADD":
            # Prefer topic from Stage 1 extraction (already normalized)
            add_topic = topic or ""
            if new_weak_points and i < len(new_weak_points):
                nwp = new_weak_points[i]
                add_topic = (nwp.get("topic", topic) if isinstance(nwp, dict) else topic) or ""
            weak_points.append({
                "point": _clean_point_text(op["point"]),
                "topic": add_topic,
                "source": op.get("source", "observed"),
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })
        elif action == "UPDATE":
            idx = op.get("index")
            if idx is not None and 0 <= idx < len(weak_points):
                wp = weak_points[idx]
                new_text = _clean_point_text(op.get("new_point", ""))
                if new_text and new_text != wp.get("point"):
                    old_text = wp["point"]
                    history = wp.setdefault("history", [])
                    history.append({"point": old_text, "date": wp.get("last_seen", now)})
                    wp["point"] = new_text
                    if user_id:
                        try:
                            upsert_weak_point_vector(old_text, new_text, wp.get("topic", topic), user_id)
                        except Exception as e:
                            logger.warning(f"Failed to sync vector for updated weak point: {e}")
                wp["times_seen"] = wp.get("times_seen", 1) + 1
                wp["last_seen"] = now
                if wp.get("archived"):
                    wp["archived"] = False
                    wp.pop("archived_at", None)
                    wp.setdefault("history", []).append({"date": now, "event": "unarchived"})
                _regress_if_improved(wp, now, evidence=new_text or wp.get("point", ""))

    for imp in ops.get("improvements", []):
        idx = imp.get("weak_index")
        if idx is not None and 0 <= idx < len(weak_points):
            wp = weak_points[idx]
            history = wp.setdefault("history", [])
            history.append({"point": wp["point"], "date": now, "event": "improved"})
            wp["improved"] = True
            wp["improved_at"] = now

    existing_strong = {s["point"] for s in profile.get("strong_points", [])}
    for i, op in enumerate(ops.get("strong_point_ops", [])):
        if op.get("action") == "ADD" and op.get("point") and op["point"] not in existing_strong:
            add_topic = topic or ""
            if new_strong_points and i < len(new_strong_points):
                nsp = new_strong_points[i]
                add_topic = (nsp.get("topic", topic) if isinstance(nsp, dict) else topic) or ""
            profile.setdefault("strong_points", []).append({
                "point": _clean_point_text(op["point"]),
                "topic": add_topic,
                "first_seen": now,
            })


def _deterministic_update(profile: dict, new_weak: list, new_strong: list,
                          topic: str | None, now: str, user_id: str):
    """Fallback: vector cosine dedup when LLM parse fails."""
    from backend.vector_memory import find_similar_weak_point

    for wp in new_weak:
        point = _clean_point_text(wp.get("point", wp) if isinstance(wp, dict) else str(wp))
        match_idx = find_similar_weak_point(point, profile.get("weak_points", []), user_id=user_id)
        if match_idx is not None:
            matched = profile["weak_points"][match_idx]
            matched["times_seen"] = matched.get("times_seen", 1) + 1
            matched["last_seen"] = now
            if matched.get("archived"):
                matched["archived"] = False
                matched.pop("archived_at", None)
                matched.setdefault("history", []).append({"date": now, "event": "unarchived"})
            _regress_if_improved(matched, now, evidence=point)
        else:
            profile.setdefault("weak_points", []).append({
                "point": point,
                "topic": wp.get("topic", topic) if isinstance(wp, dict) else (topic or ""),
                "source": wp.get("source", "observed") if isinstance(wp, dict) else "observed",
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })

    for sp in new_strong:
        sp_text = sp.get("point", sp) if isinstance(sp, dict) else str(sp)
        sp_topic = sp.get("topic") if isinstance(sp, dict) else topic
        # Use embedding similarity to find the weak point this strong point overcomes
        active_weak = [
            (i, w) for i, w in enumerate(profile.get("weak_points", []))
            if w.get("topic") == sp_topic and not w.get("improved") and not w.get("archived")
        ]
        if active_weak:
            from backend.vector_memory import _embed, _cosine_similarity
            sp_vec = _embed(sp_text, user_id)
            weak_texts = [w["point"] for _, w in active_weak]
            weak_vecs = np.stack([_embed(t, user_id) for t in weak_texts])
            sims = _cosine_similarity(sp_vec, weak_vecs)
            best_local = int(np.argmax(sims))
            if float(sims[best_local]) >= 0.5:
                _, matched_wp = active_weak[best_local]
                matched_wp["improved"] = True
                matched_wp["improved_at"] = now

        existing = {s["point"] for s in profile.get("strong_points", [])}
        if sp_text not in existing:
            profile.setdefault("strong_points", []).append({
                "point": sp_text,
                "topic": sp_topic or "",
                "first_seen": now,
            })


def _update_mastery(profile: dict, topic: str | None, mastery_data: dict, now: str,
                    min_weight: float = 0.15, user_id: str | None = None):
    """Update topic mastery (0-100 scale). Weight decreases with session count."""
    if not mastery_data:
        return
    # {score, notes} → single topic; {topic_key: {score, notes}} → multi-topic
    if "score" in mastery_data or "level" in mastery_data:
        if not topic:
            return
        entries = {topic: mastery_data}
    else:
        entries = mastery_data

    # Only allow canonical topics from topics.json
    if user_id:
        from backend.indexer import load_topics
        canonical = set(load_topics(user_id).keys())
        if canonical:
            entries = {t: d for t, d in entries.items() if t in canonical}

    for t, data in entries.items():
        if not isinstance(data, dict):
            continue
        existing = profile.setdefault("topic_mastery", {}).setdefault(t, {})
        new_score = data.get("score")
        if new_score is not None:
            old_score = existing.get("score", existing.get("level", 0) * 20)
            n = existing.get("session_count", 0)
            coverage = data.get("coverage", 1.0)
            # Dynamic weight: fast convergence early, stable later
            # Scale down by coverage so partial sessions have less impact
            weight = max(min_weight, 1.0 / (n + 1)) * coverage
            merged = round(old_score * (1 - weight) + new_score * weight, 1)
            existing["score"] = merged
            existing["session_count"] = n + 1
            existing.pop("level", None)
        if data.get("notes"):
            existing["notes"] = data["notes"]
        existing["last_assessed"] = now


def _decay_consolidated_patterns(profile: dict, now: str) -> int:
    """支撑证据大多已改善的 consolidated pattern 自动降权/标记改善（确定性，无 LLM）。

    pattern 的 consolidates 存的是支撑它的原始弱点文本。原始弱点被训练改善后，
    pattern 不该继续以原 confidence 置顶：
    - 全部支撑点 improved → pattern 也标记 improved
    - 过半 improved → 一次性降 confidence（用 history 事件保证幂等）
    支撑点文本被 UPDATE 改写后匹配不到 → 保守跳过，不衰减。
    Returns number of patterns changed.
    """
    originals = {
        wp.get("point", ""): wp
        for wp in profile.get("weak_points", [])
        if wp.get("source", "observed") != "consolidated"
    }
    changed = 0
    for wp in profile.get("weak_points", []):
        if wp.get("source") != "consolidated" or wp.get("archived") or wp.get("improved"):
            continue
        supports = [originals[p] for p in wp.get("consolidates", []) if p in originals]
        if not supports:
            continue
        improved_ratio = sum(1 for s in supports if s.get("improved")) / len(supports)
        if improved_ratio >= 1.0:
            wp["improved"] = True
            wp["improved_at"] = now
            wp.setdefault("history", []).append({
                "date": now,
                "event": "improved",
                "reason": "all_supporting_points_improved",
            })
            changed += 1
        elif improved_ratio >= 0.5:
            already_decayed = any(
                h.get("event") == "confidence_decayed" for h in wp.get("history", [])
            )
            if not already_decayed:
                wp["confidence"] = round(max(0.0, wp.get("confidence", 0.7) - 0.2), 2)
                wp.setdefault("history", []).append({
                    "date": now,
                    "event": "confidence_decayed",
                    "reason": f"{improved_ratio:.0%}_supporting_points_improved",
                })
                changed += 1
    return changed


def _archive_stale_weak_points(profile: dict):
    """Long-horizon graveyard cleanup — caps unbounded growth of one-off weak points.

    Day-to-day prioritization is handled by recency decay (_weak_point_weight), so this
    only archives points that are both very old and never recurred. Archived points stay
    in profile (file-as-truth) but drop out of active prompts/views.

    Rules:
    - last_seen > 180 days AND times_seen <= 1 → archive
    - Already improved/archived → skip
    - source == "consolidated" → skip (refreshed by re-running consolidation, not by time)
    """
    now = datetime.now()
    for wp in profile.get("weak_points", []):
        if wp.get("improved") or wp.get("archived"):
            continue
        if wp.get("source") == "consolidated":
            continue
        last_seen_str = wp.get("last_seen", "")
        if not last_seen_str:
            continue
        try:
            last_seen = datetime.fromisoformat(last_seen_str)
        except (ValueError, TypeError):
            continue
        days_since = (now - last_seen).days
        times_seen = wp.get("times_seen", 1)
        if days_since > 180 and times_seen <= 1:
            wp["archived"] = True
            wp["archived_at"] = now.isoformat()
            wp.setdefault("history", []).append({
                "date": now.isoformat(),
                "event": "archived",
                "reason": f"stale: {days_since}d since last seen, seen {times_seen}x",
            })


def _update_stats(
    profile: dict, mode: str, topic: str | None, avg_score: float | None,
    now: str, answer_count: int = 0, dimension_scores: dict | None = None,
):
    """Update session statistics with per-mode averages."""
    stats = profile.setdefault("stats", {})
    stats["total_sessions"] = stats.get("total_sessions", 0) + 1
    if mode == "resume":
        stats["resume_sessions"] = stats.get("resume_sessions", 0) + 1
    elif mode == "topic_drill":
        stats["drill_sessions"] = stats.get("drill_sessions", 0) + 1
    elif mode == "jd_prep":
        stats["job_prep_sessions"] = stats.get("job_prep_sessions", 0) + 1
    elif mode == "recording":
        stats["recording_sessions"] = stats.get("recording_sessions", 0) + 1
    elif mode == "copilot":
        stats["copilot_sessions"] = stats.get("copilot_sessions", 0) + 1

    if answer_count:
        stats["total_answers"] = stats.get("total_answers", 0) + answer_count

    if avg_score:
        history = stats.setdefault("score_history", [])
        entry = {"date": now[:10], "mode": mode, "topic": topic, "avg_score": avg_score}
        if dimension_scores:
            entry["dimension_scores"] = dimension_scores
        history.append(entry)

        # Per-mode rolling averages
        drill_scores = [h["avg_score"] for h in history if h.get("mode") == "topic_drill" and h.get("avg_score")][-20:]
        resume_scores = [h["avg_score"] for h in history if h.get("mode") == "resume" and h.get("avg_score")][-10:]
        job_prep_scores = [h["avg_score"] for h in history if h.get("mode") == "jd_prep" and h.get("avg_score")][-10:]

        if drill_scores:
            stats["drill_avg_score"] = round(sum(drill_scores) / len(drill_scores), 1)
        if resume_scores:
            stats["resume_avg_score"] = round(sum(resume_scores) / len(resume_scores), 1)
        if job_prep_scores:
            stats["job_prep_avg_score"] = round(sum(job_prep_scores) / len(job_prep_scores), 1)

        all_recent = [h["avg_score"] for h in history if h.get("avg_score")][-30:]
        if all_recent:
            stats["avg_score"] = round(sum(all_recent) / len(all_recent), 1)


async def llm_update_profile(
    mode: str,
    topic: str | None,
    new_weak_points: list[dict],
    new_strong_points: list[dict],
    topic_mastery: dict,
    user_id: str,
    session_summary: str = "",
    avg_score: float | None = None,
    answer_count: int = 0,
    dimension_scores: dict | None = None,
    behavior_ops: list | None = None,
    session_id: str | None = None,
):
    """Mem0-style profile update: LLM decides ADD/UPDATE/NOOP for each fact."""
    from backend.prompts.interviewer import PROFILE_UPDATE_PROMPT

    # LLM calls happen outside the lock (they're slow and don't touch profile)
    profile = _load_profile(user_id)
    has_new_facts = bool(new_weak_points or new_strong_points)
    ops = None
    llm_failed = False

    if has_new_facts:
        # Format existing points with indices for LLM reference
        # Topic deliberately excluded — Stage 2 only compares content, not metadata
        existing_weak_lines = []
        for i, wp in enumerate(profile.get("weak_points", [])):
            status = "已改善" if wp.get("improved") else f"出现{wp.get('times_seen', 1)}次"
            existing_weak_lines.append(f"[{i}] {wp['point']} ({status})")
        existing_strong_lines = []
        for i, sp in enumerate(profile.get("strong_points", [])):
            existing_strong_lines.append(f"[{i}] {sp['point']}")

        new_weak_lines = []
        for wp in new_weak_points:
            point = wp.get("point", wp) if isinstance(wp, dict) else str(wp)
            new_weak_lines.append(f"- {point}")
        new_strong_lines = []
        for sp in new_strong_points:
            point = sp.get("point", sp) if isinstance(sp, dict) else str(sp)
            new_strong_lines.append(f"- {point}")

        prompt = PROFILE_UPDATE_PROMPT.format(
            existing_weak="\n".join(existing_weak_lines) or "暂无",
            existing_strong="\n".join(existing_strong_lines) or "暂无",
            new_weak="\n".join(new_weak_lines) or "暂无",
            new_strong="\n".join(new_strong_lines) or "暂无",
        )

        llm = get_langchain_llm(user_id)
        response = llm.invoke([
            SystemMessage(content="你是画像更新引擎。只返回 JSON。"),
            HumanMessage(content=prompt),
        ])

        try:
            ops = _parse_json_safe(response.content)
            if not isinstance(ops, dict):
                raise ValueError(f"Expected dict, got {type(ops)}")
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Profile update LLM parse failed ({e}), falling back to deterministic")
            llm_failed = True

    # All profile mutations happen under the lock
    async with _get_profile_lock(user_id):
        # Re-load fresh profile inside the lock
        profile = _load_profile(user_id)
        now = datetime.now().isoformat()

        if has_new_facts:
            if ops and not llm_failed:
                _apply_memory_ops(profile, ops, topic, now, user_id=user_id,
                                  new_weak_points=new_weak_points,
                                  new_strong_points=new_strong_points)
            else:
                _deterministic_update(profile, new_weak_points, new_strong_points, topic, now, user_id)

        # ── Deterministic updates for mastery / stats ──
        # 表现轴观察统一走 behavior_ops;legacy communication/thinking_patterns 已停写
        _update_mastery(profile, topic, topic_mastery, now, user_id=user_id)
        _update_stats(profile, mode, topic, avg_score, now, answer_count, dimension_scores)

        # ── Behavior axis (mem0-style ops) ──
        if behavior_ops:
            tally = _apply_behavior_ops(profile, behavior_ops, session_id, now)
            logger.info(
                f"behavior_signals updated for {user_id}: {tally}"
            )

        _archive_stale_weak_points(profile)
        _decay_consolidated_patterns(profile, now)

        _save_profile(profile, user_id)

    _save_insight(mode=mode, topic=topic, summary=session_summary, raw_extraction={
        "weak_points": new_weak_points,
        "strong_points": new_strong_points,
    }, user_id=user_id)

    # Index into vector memory for future semantic retrieval
    from backend.vector_memory import index_session_memory
    index_session_memory(
        session_id=None, topic=topic,
        summary=session_summary,
        weak_points=new_weak_points,
        strong_points=new_strong_points,
        insight_text=session_summary,
        user_id=user_id,
    )

    # ── Stage 3: Consolidation (带节流, 失败不阻塞) ──
    # 从 active observed weak_points 里识别跨领域规律, 输出 source="consolidated" 的条目.
    # 内部节流: 24h cooldown + 至少 3 条新 wp + 至少 5 条 active wp 才真的跑 LLM.
    await consolidate_patterns(user_id)


def _format_existing_behavior_signals(profile: dict) -> str:
    """Format existing behavior_signals as prior for the Extract prompt.

    Strong prior pushes the LLM to reuse existing IDs rather than minting near-duplicates.
    Only surfaces a compact summary: id, polarity tag, times_seen, description.
    """
    signals = profile.get("behavior_signals", {}) or {}
    if not signals:
        return "（暂无，本次面试可以从零开始创建。新 ID 必须严格符合 `<namespace>.<snake_case>` 格式。）"

    by_ns: dict[str, list[str]] = {}
    for sid, data in signals.items():
        if data.get("improved"):
            # 还展示,但加 "(已改善)" 提示 LLM 优先用 IMPROVE 而非重复 ADD
            status = "已改善"
        else:
            status = f"出现 {data.get('times_seen', 1)} 次"
        polarity = data.get("polarity", "negative")
        polarity_tag = "+" if polarity == "positive" else "-"
        desc = (data.get("description") or "").strip() or "（无描述）"
        line = f"- [{polarity_tag}] `{sid}` （{status}）: {desc}"
        by_ns.setdefault(data.get("namespace", "other"), []).append(line)

    parts = []
    for ns in ("reasoning", "narrative", "communication", "metacognition"):
        if ns in by_ns:
            parts.append(f"### {ns}\n" + "\n".join(by_ns[ns]))
    # 任何不在四个 namespace 的兜底展示(理论上不会有,但防御一下)
    extras = [ns for ns in by_ns if ns not in BEHAVIOR_NAMESPACES]
    for ns in extras:
        parts.append(f"### {ns} (异常 namespace, 仅展示不复用)\n" + "\n".join(by_ns[ns]))

    return "\n\n".join(parts)


BEHAVIOR_EXTRACT_PROMPT = """你是面试教练的行为分析引擎。从面试记录里提取候选人作为面试者的「表现轴」行为模式。
只看"怎么表达、怎么思考、怎么讲项目、怎么自评",不评判知识对错。

## 候选人已有的 behavior_signals（优先复用这些 ID，不要起新名字除非真的不同）
{existing_behavior_signals}

## 本次面试记录
模式: {mode}
领域: {topic}
{transcript}

## 四个 namespace（**锁定，不可创新**）
- reasoning：推导/思维方式（被追问 why 时如何应对、能否从底层推导、是否跳步）
- narrative：项目叙事（讲项目的结构、量化指标、技术权衡是否讲清）
- communication：表达特征（节奏、结构信号、清晰度、口头禅）
- metacognition：元认知（自我评估准确性、对弱点的觉察、不懂装懂）

## 每个 behavior_signal 是一个 op
- **ADD**：全新模式。新 ID 格式严格为 `<namespace>.<snake_case_name>`，必须给 polarity（negative|positive）+ description（一句话锚定语义）+ snippet（本次证据）
- **UPDATE**：复用上面已有 ID。只给 snippet（本次新证据）
- **IMPROVE**：已有 negative 模式本次出现反向证据。给 evidence_snippet
- **NOOP**：不输出

ID 复用优先级最高：能用已有 ID 就**绝对不要**起新 ID。namespace 必须在四个里选。
只提取本次明确暴露的行为，不要猜测。**宁可不输出，不要凑数**——专项问答这类信息量少的场景，没有可靠证据就返回空数组。

## 输出（只返回 JSON）
{{
    "behavior_signals": [
        {{"action": "ADD", "id": "reasoning.jump_to_conclusion", "namespace": "reasoning", "polarity": "negative", "description": "被追问 why 时跳过推导直接给结论", "snippet": "讲为什么用 RAG 时只说'更省钱'就停了"}},
        {{"action": "UPDATE", "id": "narrative.lack_metrics", "snippet": "讲项目时没有任何数字指标"}}
    ]
}}
"""


def build_calibration_ops(questions: list, answers: list, scores: list) -> list:
    """答题自评 vs 实际得分的确定性元认知校准，零 LLM 调用。

    自评有把握（confidence=high）但得分 ≤4 → 过度自信证据；
    自评没把握（confidence=low）但得分 ≥8 → 过度保守证据。
    每场每个方向最多一条 op，snippet 带量化比例和例题。
    ADD 落在已有 ID 上会被 _apply_behavior_ops 降级为 UPDATE（语义锚定在首次 description）。
    """
    conf_map = {}
    for a in answers or []:
        if isinstance(a, dict) and a.get("confidence") in ("high", "low"):
            conf_map[a.get("question_id")] = a["confidence"]
    if not conf_map:
        return []

    q_text = {q.get("id"): q.get("question", "") for q in questions or [] if isinstance(q, dict)}
    score_map = {}
    for s in scores or []:
        if not isinstance(s, dict):
            continue
        try:
            score_map[s.get("question_id")] = float(s["score"])
        except (TypeError, ValueError, KeyError):
            continue

    high = [(qid, sc) for qid, sc in score_map.items() if conf_map.get(qid) == "high"]
    low = [(qid, sc) for qid, sc in score_map.items() if conf_map.get(qid) == "low"]

    ops = []
    over = [(qid, sc) for qid, sc in high if sc <= 4]
    if over:
        qid, sc = over[0]
        example = (q_text.get(qid) or "")[:30]
        ops.append({
            "action": "ADD",
            "id": "metacognition.overconfident",
            "namespace": "metacognition",
            "polarity": "negative",
            "description": "自评有把握的题实际得分偏低，自我评估偏高",
            "snippet": f"自评有把握的 {len(high)} 题中 {len(over)} 题得分 ≤4（如「{example}」{sc:g}/10）",
        })
    under = [(qid, sc) for qid, sc in low if sc >= 8]
    if under:
        qid, sc = under[0]
        example = (q_text.get(qid) or "")[:30]
        ops.append({
            "action": "ADD",
            "id": "metacognition.underconfident",
            "namespace": "metacognition",
            "polarity": "negative",
            "description": "自评没把握的题实际得分很高，自我评估偏保守",
            "snippet": f"自评没把握的 {len(low)} 题中 {len(under)} 题得分 ≥8（如「{example}」{sc:g}/10）",
        })
    return ops


async def extract_behavior_ops(transcript: str, user_id: str, mode: str, topic: str | None = None) -> list:
    """Behavior-axis-only extraction for non-resume modes.

    The resume path extracts behavior inside its big EXTRACT_PROMPT; drill / jd_prep /
    recording extract only the knowledge axis in their own graphs. This shared pass gives
    them the behavior axis too — always with the existing-signals prior so emergent IDs
    stay deduplicated instead of fragmenting. Returns behavior_ops for llm_update_profile.

    Copilot is intentionally NOT a caller: it writes predicted gaps, not observed answers,
    so it has no transcript to judge behavior from.
    """
    transcript = (transcript or "").strip()
    if not transcript:
        return []

    profile = _load_profile(user_id)
    prompt = BEHAVIOR_EXTRACT_PROMPT.format(
        existing_behavior_signals=_format_existing_behavior_signals(profile),
        mode=mode,
        topic=topic or "综合",
        transcript=transcript,
    )
    llm = get_langchain_llm(user_id)
    # 解析失败重试一次,与知识轴提取的容错策略一致
    for attempt in range(2):
        response = llm.invoke([
            SystemMessage(content="你是面试行为分析引擎。只返回 JSON。宁可不输出,不要凑数。"),
            HumanMessage(content=prompt),
        ])
        try:
            parsed = _parse_json_safe(response.content)
            ops = parsed.get("behavior_signals", []) if isinstance(parsed, dict) else []
            return ops if isinstance(ops, list) else []
        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning(f"Behavior extraction parse failed ({mode}, attempt {attempt + 1}/2): {exc}")
    return []


async def update_profile_after_interview(
    mode: str,
    topic: str | None,
    messages: list,
    user_id: str,
    scores: list[dict] | None = None,
    session_id: str | None = None,
) -> dict:
    """Mem0-style two-stage pipeline: Extract → Update."""
    profile = _load_profile(user_id)
    llm = get_langchain_llm(user_id)

    canonical = _get_canonical_topic_keys(user_id)
    allowed_topics_str = "、".join(sorted(canonical)) if canonical else "（暂无）"

    # ── Stage 1: Extract insights ──
    transcript_lines = []
    for msg in messages:
        if hasattr(msg, "content"):
            if isinstance(msg, HumanMessage):
                transcript_lines.append(f"候选人: {msg.content}")
            elif hasattr(msg, "content") and not isinstance(msg, SystemMessage):
                transcript_lines.append(f"面试官: {msg.content}")

    score_text = ""
    if scores:
        score_text = "\n".join(
            f"- Q: {s.get('question', '?')} → {s.get('score', '?')}/10 ({s.get('assessment', '')})"
            for s in scores
        )

    extract_msg = EXTRACT_PROMPT.format(
        current_profile=_compact_profile_for_extract(profile),
        existing_behavior_signals=_format_existing_behavior_signals(profile),
        mode=mode,
        topic=topic or "综合",
        transcript="\n".join(transcript_lines),
        scores=score_text or "无",
        allowed_topics=allowed_topics_str,
    )

    # 解析失败重试一次;仍失败则标记 session,用户可从历史记录补跑,
    # 否则这场面试的画像洞察会静默丢失
    extraction = None
    for attempt in range(2):
        response = llm.invoke([
            SystemMessage(content="你是面试分析引擎。只返回 JSON。"),
            HumanMessage(content=extract_msg),
        ])
        try:
            parsed = _parse_json_safe(response.content)
            if isinstance(parsed, dict):
                extraction = parsed
                break
            raise ValueError(f"expected dict, got {type(parsed)}")
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(f"Profile extraction parse failed (attempt {attempt + 1}/2): {exc}")

    extract_failed = extraction is None
    if extract_failed:
        extraction = {
            "session_summary": "提取失败",
            "weak_points": [],
            "strong_points": [],
            "behavior_signals": [],
        }

    if session_id:
        from backend.storage.sessions import update_session_meta
        try:
            update_session_meta(
                session_id, {"profile_extract_failed": extract_failed}, user_id=user_id
            )
        except Exception as exc:
            logger.warning(f"Failed to update extract-failed marker for {session_id}: {exc}")

    _normalize_extraction_topics(extraction, canonical, fallback_topic=topic or "")

    # ── Stage 2: LLM-based Update (Mem0 style) ──
    await llm_update_profile(
        mode=mode,
        topic=topic,
        new_weak_points=extraction.get("weak_points", []),
        new_strong_points=extraction.get("strong_points", []),
        topic_mastery=extraction.get("topic_mastery", {}),
        user_id=user_id,
        session_summary=extraction.get("session_summary", ""),
        avg_score=extraction.get("avg_score"),
        dimension_scores=extraction.get("dimension_scores"),
        behavior_ops=extraction.get("behavior_signals", []),
        session_id=session_id,
    )

    return extraction


# ── Stage 3: Consolidation ──────────────────────────────────────────────────
# 从扁平的 weak_points 里识别跨领域规律,产出 source="consolidated" 的高层条目。
# 被整合的原始 wp 会被 archive,reason="superseded_by_consolidation"。
# 设计要点:
# - 跨至少 2 个不同 topic 才算合格 pattern (挡住同领域换粒度的假整合)
# - 失败不影响 Stage 1/2 (整个函数 try/except 包裹)
# - 节流: 24h + 至少 3 条新 observed wp 才跑一次

CONSOLIDATE_MIN_ACTIVE_WPS = 5       # 活跃 observed wp 少于这个不跑
CONSOLIDATE_MIN_NEW_WPS = 3          # 距上次 consolidation 新增少于这个不跑
CONSOLIDATE_COOLDOWN_HOURS = 24      # 两次 consolidation 之间的最小间隔
CONSOLIDATE_MIN_SUPPORTING = 2       # 一条 pattern 至少需要引用的 wp 数
CONSOLIDATE_MIN_SPANNING_TOPICS = 2  # 必须跨多少个不同 topic
CONSOLIDATE_MAX_STATEMENT_LEN = 80   # pattern 描述的字符上限

PATTERN_FEEDBACK_STEP_DOWN = 0.3     # 用户点"不准"一次降的 confidence
PATTERN_FEEDBACK_STEP_UP = 0.1       # 用户点"准"一次升的 confidence
PATTERN_ARCHIVE_CONFIDENCE = 0.5     # confidence 低于这个直接归档


async def apply_pattern_feedback(user_id: str, point: str, verdict: str) -> dict | None:
    """用户对 consolidated pattern 的反馈 — 防 LLM 编造规律的最后防线。

    verdict: accurate（confidence 升）| inaccurate（confidence 降，低于阈值归档）
             | acknowledged（仅标记已读）。
    任何反馈都意味着用户看过这条规律 → user_acknowledged=True。
    按 point 文本定位（pattern 无独立 ID，文件即真相）。找不到返回 None。
    """
    async with _get_profile_lock(user_id):
        profile = _load_profile(user_id)
        now = datetime.now().isoformat()
        target = None
        for wp in profile.get("weak_points", []):
            if (wp.get("source") == "consolidated"
                    and wp.get("point") == point
                    and not wp.get("archived")):
                target = wp
                break
        if target is None:
            return None

        target["user_acknowledged"] = True
        confidence = target.get("confidence", 0.7)
        if verdict == "accurate":
            target["confidence"] = round(min(1.0, confidence + PATTERN_FEEDBACK_STEP_UP), 2)
            target.setdefault("history", []).append({"date": now, "event": "user_confirmed"})
        elif verdict == "inaccurate":
            target["confidence"] = round(max(0.0, confidence - PATTERN_FEEDBACK_STEP_DOWN), 2)
            target.setdefault("history", []).append({"date": now, "event": "user_refuted"})
            if target["confidence"] < PATTERN_ARCHIVE_CONFIDENCE:
                target["archived"] = True
                target["archived_at"] = now
                target["archived_reason"] = "user_refuted"

        _save_profile(profile, user_id)
        return target

CONSOLIDATE_PROMPT = """你是面试教练的模式识别引擎。你的任务是从用户的薄弱点观察列表里,
识别**用户自己可能没意识到的跨领域规律** (pattern)。

## 合格 pattern 的 4 个必要条件

一条 pattern 必须同时满足以下 4 条, 否则视为不合格:

1. **跨至少 2 个不同的领域 (topic)**
   例: [GIL (python)] + [Transformer 注意力 (llm)] + [B+ 树 (database)]
       → 跨 3 个领域, 可能是一个真规律
   反例: [GIL (python)] + [async (python)] + [描述符 (python)]
       → 全在 python 内, 这只是一个领域的弱点, 不是跨领域规律

2. **比原始观察抽象层次更高**
   例: 5 条"底层机制讲不清"的具体观察 → 1 条"对底层原理偏表面" (思考方式的倾向)
   反例: "GIL 不懂" + "async 不懂" → "Python 并发不懂"
       (这只是换了个粒度, 没有真正抽象, 不合格)

3. **是用户自己不容易察觉的规律**
   例: "被追问 'why' 时倾向跳过推导过程" (思维模式,用户自己难以看到)
   反例: "Python 的很多东西不熟" (用户自己都知道, 没价值)

4. **可证伪**
   pattern 必须是将来能被新观察验证或推翻的具体假设。
   "你可能有点紧张"这种虚话不算。

## 什么时候不要产出

以下任何一种情况, 请返回 {{"patterns": []}}:

- 观察列表里看不到跨领域的规律
- 所有观察都集中在 1-2 个具体技术点
- 你没有高度把握某条 pattern 真的成立
- 观察之间的联系只是表面相似, 不是结构性共性

**宁可产出 0 个 pattern, 不要产出 1 个错的**。
编造的 pattern 会被用户标记为不准, 损害系统可信度。
返回空数组完全不会被惩罚, 乱产出才会被惩罚。

## 输入: 用户当前的活跃薄弱点

{weak_points_formatted}

## 输出格式 (严格 JSON)

{{
  "patterns": [
    {{
      "statement": "一句话规律描述, 不超过 40 字",
      "supporting_wp_indices": [0, 3, 7],
      "topic": "cross_cutting 或 meta",
      "confidence": 0.85,
      "reasoning": "内部用, 为什么这几条指向同一规律 (不展示给用户)"
    }}
  ]
}}

只输出 JSON, 不要任何其他内容。
"""


def _filter_active_observed_wps(profile: dict) -> list[tuple[int, dict]]:
    """返回 (原 index, wp) 对的列表, 只包含活跃的 observed 知识轴条目.

    原 index 用于 consolidation 写回时精确定位 profile["weak_points"] 里的原条目.
    """
    out = []
    for i, wp in enumerate(profile.get("weak_points", [])):
        if wp.get("improved") or wp.get("archived"):
            continue
        # 只对 observed 的条目做 consolidation, 不整合已整合过的或 JD 预测的
        if wp.get("source", "observed") != "observed":
            continue
        # 跳过老数据里的 axis=performance 条目 (这类观察现在走 behavior_signals)
        if wp.get("axis") == "performance":
            continue
        out.append((i, wp))
    return out


def _validate_consolidation_pattern(pattern: dict, active: list[tuple[int, dict]]) -> str | None:
    """验证一条 LLM 产出的 pattern. 返回 None 表示通过, 否则返回拒绝原因."""
    idxs = pattern.get("supporting_wp_indices")
    if not isinstance(idxs, list) or len(idxs) < CONSOLIDATE_MIN_SUPPORTING:
        return "too_few_supporting"

    # idxs 是"输入给 LLM 时的局部 index",引用的是 active 列表的位置
    if any(not isinstance(i, int) or i < 0 or i >= len(active) for i in idxs):
        return "invalid_index"

    # 必须跨至少 2 个 topic
    topics = {active[i][1].get("topic", "") for i in idxs}
    topics.discard("")
    if len(topics) < CONSOLIDATE_MIN_SPANNING_TOPICS:
        return "not_cross_cutting"

    statement = (pattern.get("statement") or "").strip()
    if not statement:
        return "empty_statement"
    if len(statement) > CONSOLIDATE_MAX_STATEMENT_LEN:
        return "statement_too_long"

    return None


def _apply_consolidation_pattern(profile: dict, pattern: dict, active: list[tuple[int, dict]], now: str):
    """把一条 pattern 写入 profile: 追加新 consolidated wp + archive 被 supersede 的原条目."""
    idxs = pattern["supporting_wp_indices"]
    supporting_pairs = [active[i] for i in idxs]
    supporting_wps = [wp for _, wp in supporting_pairs]

    new_wp = {
        "point": pattern["statement"].strip(),
        "topic": pattern.get("topic") or "cross_cutting",
        "source": "consolidated",
        "first_seen": now,
        "last_seen": now,
        "times_seen": sum(w.get("times_seen", 1) for w in supporting_wps),
        "improved": False,
        "archived": False,
        "consolidates": [w.get("point", "") for w in supporting_wps],
        "confidence": float(pattern.get("confidence", 0.7)),
        "user_acknowledged": False,
    }
    profile.setdefault("weak_points", []).append(new_wp)

    # Archive 被 supersede 的原条目 (用原 profile index 精确定位, 防止锁外并发写)
    all_wps = profile.get("weak_points", [])
    for orig_idx, wp in supporting_pairs:
        if orig_idx >= len(all_wps):
            continue
        target = all_wps[orig_idx]
        # 再次确认这条就是我们要改的 (防止锁外并发写把 list 改了)
        if target.get("point") != wp.get("point"):
            continue
        target["archived"] = True
        target["archived_at"] = now
        target["archived_reason"] = "superseded_by_consolidation"
        target.setdefault("history", []).append({
            "date": now,
            "event": "archived",
            "reason": f"superseded by consolidation: {new_wp['point'][:40]}",
        })


def _should_run_consolidation(profile: dict) -> tuple[bool, str]:
    """检查节流条件. 返回 (是否应该跑, 原因)."""
    active = _filter_active_observed_wps(profile)
    if len(active) < CONSOLIDATE_MIN_ACTIVE_WPS:
        return False, f"too_few_active_wps ({len(active)} < {CONSOLIDATE_MIN_ACTIVE_WPS})"

    last_str = profile.get("last_consolidation_at", "")
    if last_str:
        try:
            last_time = datetime.fromisoformat(last_str)
            hours_since = (datetime.now() - last_time).total_seconds() / 3600
            if hours_since < CONSOLIDATE_COOLDOWN_HOURS:
                return False, f"cooldown (last run {hours_since:.1f}h ago)"
        except (ValueError, TypeError):
            pass  # 解析失败就当没跑过

        # 至少 N 条新 observed wp 才值得重跑
        new_count = 0
        for _, wp in active:
            first_seen = wp.get("first_seen", "")
            try:
                if datetime.fromisoformat(first_seen) > last_time:
                    new_count += 1
            except (ValueError, TypeError):
                continue
        if new_count < CONSOLIDATE_MIN_NEW_WPS:
            return False, f"too_few_new_wps ({new_count} < {CONSOLIDATE_MIN_NEW_WPS})"

    return True, "ok"


async def consolidate_patterns(user_id: str) -> dict:
    """Stage 3: 从 active observed weak_points 里识别跨领域规律.

    带节流: 满足 cooldown + 新观察数量 + 活跃数量三个条件才真的跑 LLM.
    失败不影响上游 (所有异常在这里被吞).

    Returns:
        {"ran": bool, "applied": int, "skipped": list, "reason": str}
    """
    try:
        profile = _load_profile(user_id)

        should_run, reason = _should_run_consolidation(profile)
        if not should_run:
            return {"ran": False, "applied": 0, "skipped": [], "reason": reason}

        active = _filter_active_observed_wps(profile)
        formatted = "\n".join(
            f"[{i}] {wp['point']} (领域: {wp.get('topic', '?')}, 观察 {wp.get('times_seen', 1)} 次)"
            for i, (_, wp) in enumerate(active)
        )

        llm = get_langchain_llm(user_id)
        response = llm.invoke([
            SystemMessage(content="你是面试教练的模式识别引擎。只返回 JSON。宁可不产出,不要编造。"),
            HumanMessage(content=CONSOLIDATE_PROMPT.format(weak_points_formatted=formatted)),
        ])

        try:
            parsed = _parse_json_safe(response.content)
            if not isinstance(parsed, dict):
                raise ValueError(f"Expected dict, got {type(parsed)}")
            raw_patterns = parsed.get("patterns", []) or []
            if not isinstance(raw_patterns, list):
                raise ValueError("patterns is not a list")
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Consolidation parse failed: {e}. Raw: {response.content[:200]}")
            # 解析失败不更新 last_consolidation_at, 下次 session 会重试
            return {"ran": False, "applied": 0, "skipped": [], "reason": "llm_parse_failed"}

        # 验证
        valid_patterns = []
        skipped = []
        for p in raw_patterns:
            if not isinstance(p, dict):
                skipped.append({"reason": "not_a_dict"})
                continue
            rej = _validate_consolidation_pattern(p, active)
            if rej is None:
                valid_patterns.append(p)
            else:
                skipped.append({"statement": p.get("statement", "?"), "reason": rej})

        # 写入 (在锁内)
        applied = 0
        async with _get_profile_lock(user_id):
            profile = _load_profile(user_id)
            # 锁内重新过滤 active, 因为 profile 在 LLM 期间可能被并发写
            active_inside = _filter_active_observed_wps(profile)

            # 重新验证 index 还有效 (active 可能变短了)
            now = datetime.now().isoformat()
            for p in valid_patterns:
                idxs = p["supporting_wp_indices"]
                if any(i >= len(active_inside) for i in idxs):
                    skipped.append({"statement": p.get("statement", "?"), "reason": "stale_index_after_reload"})
                    continue
                # 还要确认 active 列表的顺序没变 (通过比对 point 文本)
                ok = True
                for local_i in idxs:
                    orig_idx_outside = active[local_i][0]
                    if orig_idx_outside >= len(profile.get("weak_points", [])):
                        ok = False
                        break
                    if profile["weak_points"][orig_idx_outside].get("point") != active[local_i][1].get("point"):
                        ok = False
                        break
                if not ok:
                    skipped.append({"statement": p.get("statement", "?"), "reason": "profile_changed_during_llm"})
                    continue

                _apply_consolidation_pattern(profile, p, active, now)
                applied += 1

            profile["last_consolidation_at"] = now
            _save_profile(profile, user_id)

        logger.info(
            f"Consolidation for user {user_id}: applied={applied}, skipped={len(skipped)}, "
            f"candidates={len(raw_patterns)}"
        )
        return {"ran": True, "applied": applied, "skipped": skipped, "reason": "ok"}

    except Exception as e:
        logger.warning(f"Consolidation failed for user {user_id}: {type(e).__name__}: {e}")
        return {"ran": False, "applied": 0, "skipped": [], "reason": f"error: {type(e).__name__}"}
