"""简历模拟面试状态持久化 (SQLite) — 每会话一行 JSON,取代 LangGraph checkpoint。"""
import json
import sqlite3

from backend.config import settings

DB_PATH = settings.db_path


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS resume_interview_state (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            state TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn


def save_state(session_id: str, state: dict, *, user_id: str):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO resume_interview_state (session_id, user_id, state) VALUES (?, ?, ?) "
        "ON CONFLICT(session_id) DO UPDATE SET "
        "state = excluded.state, updated_at = CURRENT_TIMESTAMP",
        (session_id, user_id, json.dumps(state, ensure_ascii=False)),
    )
    conn.commit()
    conn.close()


def load_state(session_id: str, *, user_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT state FROM resume_interview_state WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    conn.close()
    return json.loads(row["state"]) if row else None
