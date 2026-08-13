"""JD 定向备面服务."""
import json
import logging

from backend.config import settings
from backend.graphs.topic_drill import _parse_json_response
from backend.indexer import load_resume_text
from backend.llm_provider import HumanMessage, SystemMessage, get_llm
from backend.memory import get_profile_summary
from backend.prompts.job_prep import (
    JOB_PREP_EVAL_PROMPT,
    JOB_PREP_PREVIEW_PROMPT,
    JOB_PREP_QUESTION_GEN_PROMPT,
)

logger = logging.getLogger("uvicorn")


def _has_resume(user_id: str) -> bool:
    resume_dir = settings.user_resume_path(user_id)
    return resume_dir.exists() and any(
        f.suffix.lower() == ".pdf" for f in resume_dir.iterdir() if f.is_file()
    )


def _get_resume_context(user_id: str, use_resume: bool) -> tuple[str, bool]:
    if not use_resume or not _has_resume(user_id):
        return "未启用简历联动", False

    try:
        resume_context = load_resume_text(user_id)
        return str(resume_context)[:5000], True
    except Exception as exc:
        logger.warning(f"Failed to read resume context for JD prep: {exc}")
        return "简历读取失败，本次按无简历联动处理", False


def _normalize_preview(
    data: dict,
    *,
    company: str | None,
    position: str | None,
    jd_text: str,
    resume_used: bool,
) -> dict:
    resume_alignment = data.get("resume_alignment") or {}

    preview = {
        "company": (company or data.get("company") or "").strip(),
        "position": (position or data.get("position") or "").strip(),
        "role_summary": data.get("role_summary", "").strip(),
        "focus_areas": data.get("focus_areas") or [],
        "likely_question_groups": data.get("likely_question_groups") or [],
        "resume_alignment": {
            "resume_used": resume_used,
            "fit_assessment": resume_alignment.get("fit_assessment", "").strip(),
            "matching_evidence": resume_alignment.get("matching_evidence") or [],
            "risk_gaps": resume_alignment.get("risk_gaps") or [],
            "recommended_stories": resume_alignment.get("recommended_stories") or [],
        },
        "prep_priorities": data.get("prep_priorities") or [],
        "question_blueprint": data.get("question_blueprint") or [],
        "jd_excerpt": jd_text.strip()[:1500],
    }
    return preview


def generate_job_prep_preview(
    jd_text: str,
    user_id: str,
    *,
    company: str | None = None,
    position: str | None = None,
    use_resume: bool = True,
) -> dict:
    """Analyze JD and candidate fit before starting the session."""
    resume_context, resume_used = _get_resume_context(user_id, use_resume)
    prompt = JOB_PREP_PREVIEW_PROMPT.format(
        company=(company or "未提供").strip(),
        position=(position or "未提供").strip(),
        jd_text=jd_text.strip()[:6000],
        user_profile=get_profile_summary(user_id),
        resume_context=resume_context,
    )

    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是 JD 备面分析引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])

    try:
        parsed = _parse_json_response(response)
        if not isinstance(parsed, dict):
            raise ValueError(f"Expected dict, got {type(parsed)}")
    except Exception as exc:
        logger.error(f"JD prep preview failed: {exc}")
        logger.error(f"LLM raw response: {response[:800]}")
        raise RuntimeError("JD 分析失败，LLM 返回格式异常。请重试。")

    return _normalize_preview(
        parsed,
        company=company,
        position=position,
        jd_text=jd_text,
        resume_used=resume_used,
    )


def generate_job_prep_questions(
    jd_text: str,
    preview: dict,
    user_id: str,
    *,
    use_resume: bool = True,
) -> list[dict]:
    """Generate a structured JD-oriented mock interview."""
    resume_context, _ = _get_resume_context(user_id, use_resume)
    prompt = JOB_PREP_QUESTION_GEN_PROMPT.format(
        preview_json=json.dumps(preview, ensure_ascii=False, indent=2)[:5000],
        company=preview.get("company") or "未提供",
        position=preview.get("position") or "未提供",
        jd_text=jd_text.strip()[:5000],
        user_profile=get_profile_summary(user_id),
        resume_context=resume_context,
    )

    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是 JD 备面出题引擎。只返回 JSON 数组。"),
        HumanMessage(content=prompt),
    ])

    try:
        questions = _parse_json_response(response)
        if not isinstance(questions, list):
            raise ValueError(f"Expected list, got {type(questions)}")
    except Exception as exc:
        logger.error(f"JD prep question generation failed: {exc}")
        logger.error(f"LLM raw response: {response[:800]}")
        raise RuntimeError("JD 备面出题失败，LLM 返回格式异常。请重试。")

    normalized = []
    for i, q in enumerate(questions[:8], start=1):
        if not isinstance(q, dict):
            continue
        normalized.append({
            "id": q.get("id", i),
            "question": q.get("question", "").strip(),
            "difficulty": int(q.get("difficulty", 3) or 3),
            "focus_area": q.get("focus_area", "").strip(),
            "category": q.get("category", "").strip(),
            "intent": q.get("intent", "").strip(),
        })
    if len(normalized) < 4:
        raise RuntimeError("JD 备面出题失败，生成的问题数量不足。请重试。")
    return normalized


def evaluate_job_prep_answers(
    questions: list[dict],
    answers: list[dict],
    preview: dict,
    user_id: str,
) -> dict:
    """Evaluate answers against the JD's real hiring bar."""
    answer_map = {a["question_id"]: a["answer"] for a in answers}
    answered_questions = [q for q in questions if answer_map.get(q["id"])]

    qa_lines = []
    for q in answered_questions:
        qid = q["id"]
        qa_lines.append(
            f"### Q{qid} | {q.get('category', '未分类')} | 难度 {q.get('difficulty', 3)}/5\n"
            f"**考察点**: {q.get('focus_area', '')}\n"
            f"**题目**: {q['question']}\n"
            f"**回答**: {answer_map[qid]}"
        )

    prompt = JOB_PREP_EVAL_PROMPT.format(
        company=preview.get("company") or "未提供",
        position=preview.get("position") or "未提供",
        preview_json=json.dumps(preview, ensure_ascii=False, indent=2)[:5000],
        qa_pairs="\n\n".join(qa_lines) or "候选人未作答",
    )

    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是 JD 备面评估引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])

    try:
        result = _parse_json_response(response)
        if not isinstance(result, dict):
            raise ValueError(f"Expected dict, got {type(result)}")
        return result
    except Exception as exc:
        logger.error(f"JD prep evaluation failed: {exc}")
        logger.error(f"LLM raw response: {response[:800]}")
        # Fail loudly: the caller marks the session review_failed and the UI offers a
        # retry. A fallback "解析失败" review would persist as reviewed — a dead end.
        raise RuntimeError("评估结果解析失败，请重新提交。") from exc
