"""面试记录持久化 (SQLite)."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from backend.config import settings

DB_PATH = settings.db_path


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            topic TEXT,
            meta TEXT DEFAULT '{}',
            questions TEXT DEFAULT '[]',
            transcript TEXT DEFAULT '[]',
            scores TEXT DEFAULT '[]',
            weak_points TEXT DEFAULT '[]',
            overall TEXT DEFAULT '{}',
            review TEXT,
            user_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Migrate: add columns if missing (existing DBs)
    for col, default in [("questions", "'[]'"), ("overall", "'{}'"), ("user_id", "NULL"), ("meta", "'{}'")]:
        try:
            conn.execute(f"SELECT {col} FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} TEXT DEFAULT {default}")
    conn.commit()
    return conn


def create_session(session_id: str, mode: str, topic: str | None = None,
                   questions: list | None = None, meta: dict | None = None, *, user_id: str):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO sessions (session_id, mode, topic, meta, questions, user_id) VALUES (?, ?, ?, ?, ?, ?)",
        (
            session_id,
            mode,
            topic,
            json.dumps(meta or {}, ensure_ascii=False),
            json.dumps(questions or [], ensure_ascii=False),
            user_id,
        ),
    )
    conn.commit()
    conn.close()


def append_message(session_id: str, role: str, content: str, *, user_id: str):
    conn = _get_conn()
    row = conn.execute(
        "SELECT transcript FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return
    transcript = json.loads(row["transcript"])
    transcript.append({"role": role, "content": content, "time": datetime.now().isoformat()})
    conn.execute(
        "UPDATE sessions SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ?",
        (json.dumps(transcript, ensure_ascii=False), session_id, user_id),
    )
    conn.commit()
    conn.close()


def save_drill_answers(session_id: str, answers: list[dict], *, user_id: str):
    """Save drill answers into transcript as Q&A pairs."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT questions FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return
    questions = json.loads(row["questions"])
    answer_map = {a["question_id"]: a["answer"] for a in answers}

    transcript = []
    for q in questions:
        transcript.append({"role": "assistant", "content": q["question"], "time": datetime.now().isoformat()})
        answer = answer_map.get(q["id"], "")
        if answer:
            transcript.append({"role": "user", "content": answer, "time": datetime.now().isoformat()})

    conn.execute(
        "UPDATE sessions SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ?",
        (json.dumps(transcript, ensure_ascii=False), session_id, user_id),
    )
    conn.commit()
    conn.close()


def save_review(session_id: str, review: str, scores: list = None,
                weak_points: list = None, overall: dict = None, *, user_id: str):
    conn = _get_conn()
    conn.execute(
        "UPDATE sessions SET review = ?, scores = ?, weak_points = ?, overall = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE session_id = ? AND user_id = ?",
        (review, json.dumps(scores or [], ensure_ascii=False),
         json.dumps(weak_points or [], ensure_ascii=False),
         json.dumps(overall or {}, ensure_ascii=False),
         session_id, user_id),
    )
    conn.commit()
    conn.close()


def get_session(session_id: str, *, user_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    conn.close()
    if not row:
        return None
    result = dict(row)
    result["transcript"] = json.loads(result["transcript"])
    result["meta"] = json.loads(result.get("meta", "{}") or "{}")
    result["questions"] = json.loads(result.get("questions", "[]"))
    result["scores"] = json.loads(result["scores"])
    result["weak_points"] = json.loads(result["weak_points"])
    result["overall"] = json.loads(result.get("overall", "{}") or "{}")
    return result


def list_sessions_by_topic(topic: str, *, user_id: str, limit: int = 50) -> list[dict]:
    """Get all sessions for a topic with reviews and scores."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT session_id, mode, topic, review, scores, weak_points, overall, created_at FROM sessions "
        "WHERE topic = ? AND user_id = ? AND review IS NOT NULL ORDER BY created_at ASC LIMIT ?",
        (topic, user_id, limit),
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        results.append({
            "session_id": r["session_id"],
            "mode": r["mode"],
            "topic": r["topic"],
            "review": r["review"],
            "scores": json.loads(r["scores"]) if r["scores"] else [],
            "weak_points": json.loads(r["weak_points"]) if r["weak_points"] else [],
            "overall": json.loads(r["overall"] or "{}"),
            "created_at": r["created_at"],
        })
    return results


def list_sessions(
    *, user_id: str,
    limit: int = 20,
    offset: int = 0,
    mode: str | None = None,
    topic: str | None = None,
) -> dict:
    conn = _get_conn()

    where = ["review IS NOT NULL", "user_id = ?"]
    params: list = [user_id]
    if mode:
        where.append("mode = ?")
        params.append(mode)
    if topic:
        where.append("topic = ?")
        params.append(topic)
    where_sql = " AND ".join(where)

    total = conn.execute(
        f"SELECT COUNT(*) FROM sessions WHERE {where_sql}", params,
    ).fetchone()[0]

    rows = conn.execute(
        f"SELECT session_id, mode, topic, meta, created_at, overall FROM sessions "
        f"WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    conn.close()

    items = []
    for r in rows:
        overall = json.loads(r["overall"] or "{}")
        meta = json.loads(r["meta"] or "{}")
        items.append({
            "session_id": r["session_id"],
            "mode": r["mode"],
            "topic": r["topic"],
            "meta": meta,
            "created_at": r["created_at"],
            "avg_score": overall.get("avg_score"),
        })
    return {"items": items, "total": total}


def list_reviewed_sessions_detailed(
    *, user_id: str,
    limit: int | None = None,
    mode: str | None = None,
) -> list[dict]:
    """List reviewed sessions with full payload for profile backfill."""
    conn = _get_conn()

    where = ["review IS NOT NULL", "user_id = ?"]
    params: list = [user_id]
    if mode:
        where.append("mode = ?")
        params.append(mode)
    where_sql = " AND ".join(where)

    sql = (
        "SELECT session_id, mode, topic, meta, transcript, scores, weak_points, overall, created_at "
        f"FROM sessions WHERE {where_sql} ORDER BY created_at ASC"
    )
    if isinstance(limit, int) and limit > 0:
        sql += " LIMIT ?"
        params.append(limit)

    rows = conn.execute(sql, params).fetchall()
    conn.close()

    items = []
    for r in rows:
        items.append({
            "session_id": r["session_id"],
            "mode": r["mode"],
            "topic": r["topic"],
            "meta": json.loads(r["meta"] or "{}"),
            "transcript": json.loads(r["transcript"] or "[]"),
            "scores": json.loads(r["scores"] or "[]"),
            "weak_points": json.loads(r["weak_points"] or "[]"),
            "overall": json.loads(r["overall"] or "{}"),
            "created_at": r["created_at"],
        })
    return items


def delete_session(session_id: str, *, user_id: str) -> bool:
    conn = _get_conn()
    cursor = conn.execute(
        "DELETE FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    )
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def list_distinct_topics(*, user_id: str) -> list[str]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT DISTINCT topic FROM sessions "
        "WHERE topic IS NOT NULL AND review IS NOT NULL AND user_id = ? ORDER BY topic",
        (user_id,),
    ).fetchall()
    conn.close()
    return [r["topic"] for r in rows]
