"""Profile routes and retrospective generation."""

import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage

from backend.auth import get_current_user
from backend.config import settings
from backend.indexer import load_topics
from backend.memory import get_profile
from backend.runtime import _task_status
from backend.storage.sessions import list_sessions_by_topic

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api")


@router.get("/profile")
def get_user_profile(user_id: str = Depends(get_current_user)):
    """Get the user's accumulated interview profile.

    附带 due_reviews: SM-2 调度里今天到期该复习的知识点(计算值,不落盘),
    让画像页能给出"今天练什么"而不只是"哪里弱"。
    """
    from backend.spaced_repetition import get_due_reviews

    profile = get_profile(user_id)
    profile["due_reviews"] = [
        {
            "point": wp.get("point"),
            "topic": wp.get("topic"),
            "next_review": wp.get("sr", {}).get("next_review"),
        }
        for wp in get_due_reviews(user_id)
    ]
    return profile


@router.post("/profile/infer-target-role")
def infer_target_role(user_id: str = Depends(get_current_user)):
    """LLM-infer a target role from the candidate's resume. Does not persist."""
    resume_dir = settings.user_resume_path(user_id)
    if not resume_dir.exists() or not any(p.suffix.lower() == ".pdf" for p in resume_dir.iterdir()):
        raise HTTPException(400, "请先上传简历")

    from backend.indexer import query_resume
    from backend.llm_provider import get_langchain_llm
    from backend.prompts.interviewer import INFER_TARGET_ROLE_PROMPT

    try:
        resume_ctx = query_resume(
            "列出候选人的技术栈、项目方向、教育背景与目标岗位相关线索", user_id
        )
    except Exception as exc:
        raise HTTPException(500, f"读取简历失败: {exc}")

    llm = get_langchain_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是岗位推断引擎。只返回岗位名称，不要任何其他内容。"),
        HumanMessage(content=INFER_TARGET_ROLE_PROMPT.format(resume_context=resume_ctx)),
    ])
    role = (response.content or "").strip().strip('"').strip("「」").strip()
    if not role:
        raise HTTPException(500, "推断失败，请手动填写")
    return {"target_role": role}


@router.post("/profile/viewed")
async def profile_viewed(user_id: str = Depends(get_current_user)):
    """Reset the visit baseline used by the profile page's since-last-visit delta."""
    from backend.memory import mark_profile_viewed

    return await mark_profile_viewed(user_id)


@router.post("/profile/pattern/feedback")
async def pattern_feedback(body: dict, user_id: str = Depends(get_current_user)):
    """User feedback on a consolidated pattern: accurate / inaccurate / acknowledged."""
    from backend.memory import apply_pattern_feedback

    point = (body.get("point") or "").strip()
    verdict = body.get("verdict")
    if not point or verdict not in ("accurate", "inaccurate", "acknowledged"):
        raise HTTPException(400, "需要 point 和 verdict (accurate|inaccurate|acknowledged)")
    updated = await apply_pattern_feedback(user_id, point, verdict)
    if updated is None:
        raise HTTPException(404, "未找到该规律")
    return updated


@router.get("/profile/due-reviews")
def get_due_reviews_endpoint(topic: str = None, user_id: str = Depends(get_current_user)):
    """Get weak points due for spaced repetition review."""
    from backend.spaced_repetition import get_due_reviews as _get_due

    return _get_due(user_id, topic)


@router.get("/profile/topic/{topic}/history")
def get_topic_history(topic: str, user_id: str = Depends(get_current_user)):
    """Get session history for a specific topic."""
    return list_sessions_by_topic(topic, user_id=user_id)


def _generate_retrospective_background(task_id: str, topic: str, user_id: str):
    """Background task: generate topic retrospective."""
    try:
        from backend.llm_provider import get_langchain_llm
        from backend.memory import _load_profile, _save_profile
        from backend.prompts.interviewer import TOPIC_RETROSPECTIVE_PROMPT

        sessions = list_sessions_by_topic(topic, user_id=user_id)
        profile = _load_profile(user_id)
        topic_display = {key: value["name"] for key, value in load_topics(user_id).items()}
        topic_name = topic_display.get(topic, topic)
        mastery = profile.get("topic_mastery", {}).get(topic, {})

        history_lines = []
        for session in sessions:
            date = session["created_at"][:10]
            scores = session.get("scores", [])
            valid_scores = [score for score in scores if isinstance(score.get("score"), (int, float))]
            avg_score = round(sum(score["score"] for score in valid_scores) / len(valid_scores), 1) if valid_scores else None
            review = session.get("review") or ""
            summary_part = review.split("## 逐题复盘")[0].strip()
            score_lines = []
            for score in valid_scores:
                line = f"- Q{score.get('question_id', '?')}: {score['score']}/10"
                if score.get("assessment"):
                    line += f" — {score['assessment']}"
                score_lines.append(line)
            history_lines.append(
                f"### {date} (答题 {len(valid_scores)}/10, 平均 {avg_score or '无'}/10)\n"
                f"{summary_part}\n"
                + ("\n".join(score_lines) + "\n" if score_lines else "")
            )

        mastery_score = mastery.get("score", mastery.get("level", 0) * 20)
        mastery_text = f"{mastery_score}/100 — {mastery.get('notes', '')}" if mastery_score > 0 else "暂无评估"

        prompt = TOPIC_RETROSPECTIVE_PROMPT.format(
            topic_name=topic_name,
            session_history="\n".join(history_lines),
            mastery_info=mastery_text,
        )

        llm = get_langchain_llm(user_id)
        response = llm.invoke([
            SystemMessage(content="你是面试教练。用 markdown 生成回顾报告。"),
            HumanMessage(content=prompt),
        ])

        retrospective = response.content.strip()
        generated_at = datetime.now().isoformat()
        profile.setdefault("topic_mastery", {}).setdefault(topic, {})["retrospective"] = retrospective
        profile["topic_mastery"][topic]["retrospective_at"] = generated_at
        _save_profile(profile, user_id)

        _task_status[task_id] = {
            "status": "done",
            "type": "retrospective",
            "result": {
                "topic": topic,
                "topic_name": topic_name,
                "retrospective": retrospective,
                "retrospective_at": generated_at,
                "session_count": len(sessions),
            },
        }
        logger.info("Retrospective generated for topic %s", topic)
    except Exception as exc:
        _task_status[task_id] = {"status": "error", "type": "retrospective"}
        logger.error("Retrospective failed for topic %s: %s", topic, exc)


@router.post("/profile/topic/{topic}/retrospective")
async def generate_retrospective(
    topic: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """Generate a comprehensive retrospective — async background processing."""
    sessions = list_sessions_by_topic(topic, user_id=user_id)
    if not sessions:
        raise HTTPException(400, "该领域暂无训练记录")

    task_id = f"retro_{topic}_{user_id[:8]}"
    existing = _task_status.get(task_id)
    if existing and existing.get("status") == "pending":
        return {"task_id": task_id, "status": "pending"}

    _task_status[task_id] = {"status": "pending", "type": "retrospective"}
    background_tasks.add_task(_generate_retrospective_background, task_id, topic, user_id)
    return {"task_id": task_id, "status": "pending"}
