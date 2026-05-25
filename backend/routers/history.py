"""History and task status routes."""

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.runtime import _task_status
from backend.storage.sessions import (
    STATUS_REVIEW_FAILED,
    STATUS_REVIEWED,
    delete_session,
    expire_stale_reviewing,
    get_session,
    list_distinct_topics,
    list_sessions,
)

router = APIRouter(prefix="/api")


@router.get("/interview/review/{session_id}")
async def get_review(session_id: str, user_id: str = Depends(get_current_user)):
    """Get review for a completed session."""
    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if not session.get("review"):
        raise HTTPException(400, "Interview not yet reviewed.")
    return session


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str, user_id: str = Depends(get_current_user)):
    """Poll async task status.

    The in-memory task dict is lost on restart and never flips when a review
    hangs, so when there's no live "done"/"error" to report we reconcile against
    the persisted session — the source of truth — expiring stale reviews first.
    """
    task = _task_status.get(task_id)
    if not task or task.get("status") not in ("done", "error"):
        expire_stale_reviewing(user_id=user_id)
        session = get_session(task_id, user_id=user_id)
        if session and session["status"] == STATUS_REVIEWED:
            return {"task_id": task_id, "status": "done"}
        if session and session["status"] == STATUS_REVIEW_FAILED:
            return {"task_id": task_id, "status": "error", "result": session.get("review_error")}
    if not task:
        raise HTTPException(404, "Task not found.")
    return {"task_id": task_id, **task}


@router.get("/interview/history")
async def get_history(
    limit: int = 20,
    offset: int = 0,
    mode: str = None,
    topic: str = None,
    user_id: str = Depends(get_current_user),
):
    """List past interview sessions with filtering and pagination."""
    expire_stale_reviewing(user_id=user_id)
    return list_sessions(user_id=user_id, limit=limit, offset=offset, mode=mode, topic=topic)


@router.delete("/interview/session/{session_id}")
async def delete_session_endpoint(session_id: str, user_id: str = Depends(get_current_user)):
    """Delete a session record."""
    deleted = delete_session(session_id, user_id=user_id)
    if not deleted:
        raise HTTPException(404, "Session not found.")
    return {"ok": True}


@router.get("/interview/topics")
async def get_interview_topics(user_id: str = Depends(get_current_user)):
    """List distinct topics from completed sessions (for filter dropdown)."""
    return list_distinct_topics(user_id=user_id)
