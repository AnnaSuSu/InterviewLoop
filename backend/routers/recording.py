"""Recording review routes."""

import asyncio
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from backend.auth import get_current_user
from backend.llm_provider import HumanMessage, SystemMessage
from backend.memory import extract_behavior_ops, llm_update_profile
from backend.models import RecordingAnalyzeRequest
from backend.review_formatters import format_drill_review, format_solo_review
from backend.runtime import _task_status
from backend.storage.sessions import (
    STATUS_REVIEW_FAILED,
    STATUS_REVIEWING,
    append_message,
    create_session,
    save_drill_answers,
    save_review,
    save_session_questions,
    update_session_status,
)

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api")


@router.post("/recording/transcribe")
async def recording_transcribe(
    file: UploadFile = File(...),
    mode: str = Form("dual"),
    user_id: str = Depends(get_current_user),
):
    """Transcribe recording audio via DashScope ASR."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file.")

    suffix = "." + (file.filename or "audio.webm").rsplit(".", 1)[-1]

    try:
        from backend.transcribe import transcribe_long

        text = await asyncio.to_thread(transcribe_long, audio_bytes, suffix=suffix)
        return {"transcript": text, "segments": []}
    except Exception as exc:
        raise HTTPException(500, f"Transcription failed: {exc}")


def _analyze_recording_background(
    session_id: str,
    req_transcript: str,
    req_recording_mode: str,
    req_company: str | None,
    req_position: str | None,
    user_id: str,
):
    """Background task: analyze recording transcript."""
    try:
        from backend.graphs.topic_drill import _parse_json_response
        from backend.llm_provider import get_llm
        from backend.memory import get_profile_summary
        from backend.prompts.recording import (
            RECORDING_DUAL_EVAL_PROMPT,
            RECORDING_SOLO_EVAL_PROMPT,
            RECORDING_STRUCTURE_PROMPT,
        )

        llm = get_llm(user_id)
        profile_summary = get_profile_summary(user_id)

        if req_recording_mode == "dual":
            structure_prompt = RECORDING_STRUCTURE_PROMPT.format(transcript=req_transcript)
            response = llm.invoke([
                SystemMessage(content="你是面试记录分析引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=structure_prompt),
            ])
            structured = _parse_json_response(response)
            qa_pairs = structured.get("qa_pairs", [])

            questions, answers = [], []
            for pair in qa_pairs:
                question_id = pair.get("id", len(questions) + 1)
                questions.append({
                    "id": question_id,
                    "question": pair["question"],
                    "difficulty": 3,
                    "focus_area": pair.get("focus_area", ""),
                })
                answers.append({"question_id": question_id, "answer": pair.get("answer", "")})

            qa_lines = [
                f"### Q{question['id']} ({question.get('focus_area', '')})\n**题目**: {question['question']}\n**回答**: {answer['answer']}"
                for question, answer in zip(questions, answers)
            ]
            save_session_questions(session_id, questions, user_id=user_id)

            eval_prompt = RECORDING_DUAL_EVAL_PROMPT.format(
                qa_pairs="\n\n".join(qa_lines),
                profile_summary=profile_summary,
            )
            eval_prompt += _recording_context(req_company, req_position)
            eval_response = llm.invoke([
                SystemMessage(content="你是面试评估引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=eval_prompt),
            ])
            eval_result = _parse_json_response(eval_response)
            scores = eval_result.get("scores", [])
            overall = eval_result.get("overall", {})
            for score in scores:
                score.setdefault("difficulty", 3)

            review = format_drill_review(questions, answers, scores, overall)
            save_drill_answers(session_id, answers, user_id=user_id)
            save_review(
                session_id,
                review,
                scores,
                overall.get("new_weak_points", []),
                overall,
                user_id=user_id,
            )
        else:
            eval_prompt = RECORDING_SOLO_EVAL_PROMPT.format(
                transcript=req_transcript,
                profile_summary=profile_summary,
            )
            eval_prompt += _recording_context(req_company, req_position)
            response = llm.invoke([
                SystemMessage(content="你是录音评估引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=eval_prompt),
            ])
            eval_result = _parse_json_response(response)
            topics_covered = eval_result.get("topics_covered", [])
            overall = eval_result.get("overall", {})
            overall["topics_covered"] = topics_covered
            scores = [
                {"question_id": topic.get("id", index + 1), "score": topic.get("score"), "difficulty": 3}
                for index, topic in enumerate(topics_covered)
            ]

            review = format_solo_review(topics_covered, overall)
            save_review(
                session_id,
                review,
                scores,
                overall.get("new_weak_points", []),
                overall,
                user_id=user_id,
            )

        try:
            asyncio.run(_update_recording_profile(
                overall, scores, max(len(scores), 1), user_id,
                transcript=req_transcript, session_id=session_id,
            ))
        except Exception as exc:
            # The review is already durable. Profile write-back is best effort and
            # must not turn a usable report into a failed session.
            logger.warning("Recording profile write-back failed for %s: %s", session_id, exc)

        _task_status[session_id] = {"status": "done", "type": "recording"}
        logger.info("Recording analysis done for session %s", session_id)
    except Exception as exc:
        update_session_status(
            session_id,
            STATUS_REVIEW_FAILED,
            user_id=user_id,
            review_error=str(exc)[:500] or "未知错误",
        )
        _task_status[session_id] = {"status": "error", "type": "recording"}
        logger.error("Recording analysis failed for session %s: %s", session_id, exc, exc_info=True)


def _recording_context(company: str | None, position: str | None) -> str:
    values = []
    if company:
        values.append(f"公司: {company.strip()}")
    if position:
        values.append(f"岗位: {position.strip()}")
    if not values:
        return ""
    return "\n\n## 面试背景\n" + "\n".join(values)


@router.post("/recording/analyze")
async def recording_analyze(
    req: RecordingAnalyzeRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """Analyze a recording transcript — async background processing."""
    if not req.transcript.strip():
        raise HTTPException(400, "Transcript must not be blank.")

    session_id = str(uuid.uuid4())
    meta = {
        "recording_mode": req.recording_mode,
        "company": (req.company or "").strip(),
        "position": (req.position or "").strip(),
        "source_transcript": req.transcript,
    }
    create_session(session_id, mode="recording", meta=meta, user_id=user_id)
    append_message(session_id, "user", req.transcript, user_id=user_id)
    update_session_status(session_id, STATUS_REVIEWING, user_id=user_id)

    _task_status[session_id] = {"status": "pending", "type": "recording"}
    background_tasks.add_task(
        _analyze_recording_background,
        session_id,
        req.transcript,
        req.recording_mode,
        req.company,
        req.position,
        user_id,
    )
    return {"session_id": session_id, "status": "pending"}


async def _update_recording_profile(overall: dict, scores: list, total_items: int, user_id: str,
                                    transcript: str = "", session_id: str | None = None):
    """Update profile from recording analysis — no single topic, points carry their own topic."""
    valid = []
    for score in scores:
        try:
            valid.append(float(score["score"]))
        except (TypeError, ValueError, KeyError):
            pass

    behavior_ops = await extract_behavior_ops(transcript, user_id, mode="recording", topic=None)

    await llm_update_profile(
        mode="recording",
        topic=None,
        new_weak_points=overall.get("new_weak_points", []),
        new_strong_points=overall.get("new_strong_points", []),
        topic_mastery={},
        user_id=user_id,
        session_summary=overall.get("summary", ""),
        avg_score=overall.get("avg_score"),
        answer_count=len(valid),
        behavior_ops=behavior_ops,
        session_id=session_id,
    )
