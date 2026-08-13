"""模式2: 专项强化训练 — 批量出题 + 批量评估."""
import json

from backend.config import settings
from backend.llm_provider import HumanMessage, SystemMessage, get_llm
from backend.indexer import (
    retrieve_topic_context, load_topics, get_topic_knowledge,
    load_topic_documents, KNOWLEDGE_CHAR_BUDGET,
)
from backend.memory import get_profile_summary_for_drill, get_topic_context_for_drill
from backend.prompts.interviewer import DRILL_QUESTION_GEN_PROMPT, DRILL_BATCH_EVAL_PROMPT


def _get_topic_display(user_id: str) -> dict[str, str]:
    """Dynamic {key: display_name} from topics.json."""
    return {k: v["name"] for k, v in load_topics(user_id).items()}


from backend.utils import parse_json_response as _parse_json_response  # noqa: E402


# High-freq is stuffed verbatim into every drill prompt, so cap it. The file keeps
# everything; only the slice fed to the LLM is bounded (cut at a line boundary).
HIGH_FREQ_CHAR_BUDGET = 4000


def _load_high_freq(topic: str, user_id: str) -> str:
    """Load high-frequency question bank for a topic, capped to the prompt budget."""
    filepath = settings.user_high_freq_path(user_id) / f"{topic}.md"
    if not filepath.exists():
        return ""
    text = filepath.read_text(encoding="utf-8").strip()
    if len(text) > HIGH_FREQ_CHAR_BUDGET:
        text = text[:HIGH_FREQ_CHAR_BUDGET].rsplit("\n", 1)[0]
    return text


_DIVERGENCE_TO_WEAK_RATIO = {1: 0.8, 2: 0.6, 3: 0.3, 4: 0.15, 5: 0.0}


def generate_drill_questions(
    topic: str,
    user_id: str,
    *,
    num_questions: int = 10,
    divergence: int = 3,
) -> list[dict]:
    """Generate personalized questions for a topic. 1 LLM call."""
    from backend.spaced_repetition import get_due_reviews, init_sr_for_existing_points

    # Ensure existing weak points have SR state
    init_sr_for_existing_points(user_id)

    topic_display = _get_topic_display(user_id)
    topic_name = topic_display.get(topic, topic)
    drill_ctx = get_topic_context_for_drill(topic, user_id)

    # Spaced repetition: prioritize due reviews
    due_reviews = get_due_reviews(user_id, topic)
    due_points = [wp["point"] for wp in due_reviews[:5]]

    all_weak = list(drill_ctx["weak_points"])
    for dp in due_points:
        if dp not in all_weak:
            all_weak.insert(0, dp)

    # Knowledge context: stuff the whole corpus when it fits, else RAG-retrieve
    # prioritizing weak areas.
    queries = []
    if all_weak:
        queries.append(" ".join(all_weak[:5]))
    queries.append(f"{topic_name} 核心知识点 面试常见问题")
    knowledge_ctx = get_topic_knowledge(topic, queries, user_id)

    # Format past insights from vector retrieval
    past_insights_text = "\n".join(
        f"- {ins[:500]}" for ins in drill_ctx.get("past_insights", [])
    ) or "暂无历史数据"

    # Load high-frequency questions
    high_freq = _load_high_freq(topic, user_id) or "暂无"

    # Format weak points, marking due reviews
    weak_lines = []
    for w in all_weak[:10]:
        prefix = "[到期复习] " if w in due_points else ""
        weak_lines.append(f"- {prefix}{w}")

    # Difficulty range and question strategy based on mastery
    mastery_score = drill_ctx["mastery_score"]
    if mastery_score <= 30:
        diff_min, diff_max = 1, 3
        question_strategy = (
            "当前为新手阶段（掌握度 0-30），题目策略：\n"
            "- 70% 基础概念题 + 对比辨析题，30% 简单应用题\n"
            "- 基础概念题考的是「是什么」和「为什么」：核心定义、基本原理、常见术语的含义\n"
            "- 不要考底层实现细节、内核机制、源码级原理等深度概念\n"
            "- 不要出复杂场景设计题或系统架构题，先确认基础概念是否扎实\n"
            "- 概念题要考理解而非背诵——问「为什么这样设计」而非「请背诵定义」"
        )
    elif mastery_score <= 60:
        diff_min, diff_max = 2, 4
        question_strategy = (
            "当前有基础（掌握度 30-60），题目策略：\n"
            "- 40% 深度概念题（底层原理、实现机制、边界行为），40% 场景应用题，20% 设计权衡题\n"
            "- 可以考底层原理和内部机制，但场景题控制在单组件/单服务范围，不需要大规模系统设计"
        )
    else:
        diff_min, diff_max = 3, 5
        question_strategy = (
            "当前已熟练（掌握度 60-100），题目策略：\n"
            "- 20% 概念题（考边界 case 和底层原理），80% 场景设计 + 系统权衡题"
        )

    # 趋势调难度: 明显上升时上探一档验证提升是否扎实,明显下滑时降下限巩固基础
    trend = drill_ctx.get("trend")
    if trend and abs(trend["delta"]) >= 1.5:
        n = len(trend["scores"])
        if trend["direction"] == "up" and diff_max < 5:
            diff_max += 1
            question_strategy += (
                f"\n- 近 {n} 次训练均分从 {trend['first']} 升到 {trend['last']}，进步明显——"
                "适当上探更高难度，验证提升是否扎实"
            )
        elif trend["direction"] == "down" and diff_min > 1:
            diff_min -= 1
            question_strategy += (
                f"\n- 近 {n} 次训练均分从 {trend['first']} 降到 {trend['last']}——"
                "适当回落难度，先巩固基础再上探"
            )

    weak_ratio = _DIVERGENCE_TO_WEAK_RATIO.get(divergence, 0.3)
    weak_count = round(num_questions * weak_ratio)

    prompt = DRILL_QUESTION_GEN_PROMPT.format(
        topic_name=topic_name,
        knowledge_context=knowledge_ctx,
        user_profile=get_profile_summary_for_drill(user_id),
        mastery_info=drill_ctx["mastery_info"],
        weak_points="\n".join(weak_lines) or "暂无",
        high_freq_questions=high_freq,
        recent_questions="\n".join(f"- {q}" for q in drill_ctx["recent_questions"][-10:]) or "暂无",
        past_insights=past_insights_text,
        question_strategy=question_strategy,
        diff_min=diff_min,
        diff_max=diff_max,
        num_questions=num_questions,
        weak_count=weak_count,
    )

    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是专项训练出题引擎。只返回 JSON 数组，不要其他内容。"),
        HumanMessage(content=prompt),
    ])

    try:
        questions = _parse_json_response(response)
        if not isinstance(questions, list):
            raise ValueError(f"Expected a list, got {type(questions)}")
        # Ensure each question has an id
        for i, q in enumerate(questions):
            if "id" not in q:
                q["id"] = i + 1
        return questions[:num_questions]
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        import logging
        logger = logging.getLogger("uvicorn")
        logger.error(f"Drill question generation failed: {e}")
        logger.error(f"LLM raw response: {response[:500]}")
        raise RuntimeError(f"出题失败，LLM 返回格式异常: {e}")


def evaluate_drill_answers(topic: str, questions: list[dict], answers: list[dict],
                           user_id: str) -> dict:
    """Batch evaluate all answers. 1 LLM call."""
    topic_display = _get_topic_display(user_id)
    topic_name = topic_display.get(topic, topic)
    answer_map = {a["question_id"]: a["answer"] for a in answers}

    # Only evaluate answered questions
    answered_questions = [q for q in questions if answer_map.get(q["id"])]

    qa_lines = []
    for q in answered_questions:
        qid = q["id"]
        answer = answer_map[qid]
        qa_lines.append(f"### Q{qid} (难度 {q.get('difficulty', '?')}/5)\n**题目**: {q['question']}\n**回答**: {answer}")

    # References: stuff the whole corpus when it fits (one shared yardstick, no miss);
    # otherwise retrieve per-question slices targeted at each answered question.
    full_core = load_topic_documents(topic, user_id)
    if 0 < len(full_core) <= KNOWLEDGE_CHAR_BUDGET:
        references = f"### 该领域参考知识\n{full_core}"
    else:
        ref_lines = []
        for q in answered_questions:
            refs = retrieve_topic_context(topic, q["question"], user_id, top_k=2)
            if refs:
                ref_lines.append(f"### Q{q['id']} 参考\n" + "\n".join(refs)[:2000])
        references = "\n\n".join(ref_lines)[:KNOWLEDGE_CHAR_BUDGET]

    prompt = DRILL_BATCH_EVAL_PROMPT.format(
        topic_name=topic_name,
        topic_key=topic,
        qa_pairs="\n\n".join(qa_lines),
        references=references,
    )

    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是训练评估引擎。只返回 JSON，不要其他内容。"),
        HumanMessage(content=prompt),
    ])

    try:
        result = _parse_json_response(response)
        if not isinstance(result, dict):
            raise ValueError(f"Expected a dict, got {type(result)}")
        return result
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        import logging
        logger = logging.getLogger("uvicorn")
        logger.error(f"Drill evaluation failed: {e}")
        logger.error(f"LLM raw response: {response[:500]}")
        # Fail loudly so the session is marked review_failed and the UI shows a retry —
        # a fallback "解析失败" review would persist as reviewed (dead end).
        raise RuntimeError("评估结果解析失败，请重新提交。") from e
