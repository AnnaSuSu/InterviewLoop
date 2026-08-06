import asyncio
import io
import json
import sqlite3
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import BackgroundTasks, HTTPException
from langchain_core.messages import AIMessage

from backend import memory
from backend.config import settings
from backend.graphs import resume_interview as resume_graph
from backend.models import InterviewMode, StartInterviewRequest
from backend.routers import copilot, data_migration as migration_router, interview, recording
from backend.runtime import _task_status
from backend.storage import data_migration, sessions
from backend.utils import safe_child_path


class ProfilePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.profile_path = Path(self.temp_dir.name) / "profile.json"
        self.path_patch = patch.object(
            memory, "_profile_path", return_value=self.profile_path
        )
        self.path_patch.start()

    def tearDown(self):
        self.path_patch.stop()
        self.temp_dir.cleanup()

    def _temporary_files(self):
        return list(self.profile_path.parent.glob(f".{self.profile_path.name}.*.tmp"))

    def _write_existing_profile(self):
        original = json.dumps(
            {"name": "existing", "updated_at": "before"},
            ensure_ascii=False,
        ).encode()
        self.profile_path.write_bytes(original)
        return original

    def test_save_profile_replaces_file_with_valid_json(self):
        profile = {"name": "new profile"}

        memory._save_profile(profile, "user-a")

        saved = json.loads(self.profile_path.read_text(encoding="utf-8"))
        self.assertEqual(saved, profile)
        self.assertTrue(saved["updated_at"])
        self.assertEqual(self._temporary_files(), [])

    def test_serialization_failure_keeps_existing_profile_and_cleans_temp_file(self):
        original = self._write_existing_profile()

        with self.assertRaises(TypeError):
            memory._save_profile({"not_json": object()}, "user-a")

        self.assertEqual(self.profile_path.read_bytes(), original)
        self.assertEqual(self._temporary_files(), [])

    def test_replace_failure_keeps_existing_profile_and_cleans_temp_file(self):
        original = self._write_existing_profile()

        with patch.object(memory.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaisesRegex(OSError, "replace failed"):
                memory._save_profile({"name": "new profile"}, "user-a")

        self.assertEqual(self.profile_path.read_bytes(), original)
        self.assertEqual(self._temporary_files(), [])


class DataExportIsolationTests(unittest.TestCase):
    def test_user_export_contains_only_their_sessions_table(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.db"
            exported = root / "exported.db"

            with sqlite3.connect(source) as conn:
                conn.execute(data_migration._SESSIONS_DDL)
                conn.execute(
                    "INSERT INTO sessions (session_id, mode, user_id) VALUES (?, ?, ?)",
                    ("mine", "recording", "user-a"),
                )
                conn.execute(
                    "INSERT INTO sessions (session_id, mode, user_id) VALUES (?, ?, ?)",
                    ("theirs", "resume", "user-b"),
                )
                conn.execute("CREATE TABLE users (id TEXT, email TEXT, password TEXT)")
                conn.execute(
                    "INSERT INTO users VALUES (?, ?, ?)",
                    ("user-b", "other@example.com", "bcrypt-hash"),
                )
                conn.execute("CREATE TABLE memory_vectors (user_id TEXT, content TEXT)")
                conn.execute(
                    "INSERT INTO memory_vectors VALUES (?, ?)",
                    ("user-b", "other user's resume"),
                )

            with patch.object(settings, "db_path", source):
                data_migration._export_filtered_db("user-a", exported)

            with sqlite3.connect(exported) as conn:
                tables = {
                    row[0]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                rows = conn.execute(
                    "SELECT session_id, user_id FROM sessions"
                ).fetchall()

            self.assertEqual(tables, {"sessions"})
            self.assertEqual(rows, [("mine", "user-a")])

    def test_full_export_snapshot_keeps_all_database_tables(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "source.db"
            snapshot = Path(td) / "snapshot.db"
            with sqlite3.connect(source) as conn:
                conn.execute(data_migration._SESSIONS_DDL)
                conn.execute("CREATE TABLE users (id TEXT, email TEXT)")
                conn.execute("INSERT INTO users VALUES ('user-a', 'a@example.com')")

            with patch.object(settings, "db_path", source):
                data_migration._export_full_db(snapshot)

            with sqlite3.connect(snapshot) as conn:
                tables = {
                    row[0]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                users = conn.execute("SELECT * FROM users").fetchall()

            self.assertEqual(tables, {"sessions", "users"})
            self.assertEqual(users, [("user-a", "a@example.com")])

    def test_http_export_requires_admin_and_requests_a_full_archive(self):
        background = BackgroundTasks()
        with patch.object(migration_router, "is_admin_user", return_value=False):
            with self.assertRaisesRegex(HTTPException, "Only administrators") as raised:
                migration_router.export_data(background, user_id="user-a")
        self.assertEqual(raised.exception.status_code, 403)

        created_dir = None

        def fake_export(path, **kwargs):
            nonlocal created_dir
            self.assertEqual(kwargs, {})
            created_dir = path.parent
            path.write_bytes(b"archive")
            return path

        with (
            patch.object(migration_router, "is_admin_user", return_value=True),
            patch.object(migration_router, "export_archive", side_effect=fake_export),
        ):
            response = migration_router.export_data(
                BackgroundTasks(), user_id="admin-user"
            )

        self.assertTrue(Path(response.path).exists())
        if created_dir:
            migration_router._cleanup_dir(created_dir)

    def test_personal_import_rejects_a_full_system_archive(self):
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / "full.tar.gz"
            manifest = json.dumps({
                "schema_version": data_migration.SCHEMA_VERSION,
                "user_id": None,
            }).encode()
            with tarfile.open(archive, "w:gz") as tar:
                info = tarfile.TarInfo("manifest.json")
                info.size = len(manifest)
                tar.addfile(info, io.BytesIO(manifest))

            with self.assertRaisesRegex(ValueError, "单账户备份"):
                data_migration.import_archive(
                    archive,
                    rebind_user_id="user-a",
                    require_personal_archive=True,
                )


class RecordingPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "recording.db"
        self.db_patch = patch.object(sessions, "DB_PATH", self.db_path)
        self.db_patch.start()
        _task_status.clear()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    @staticmethod
    def _create_recording_session(session_id="rec-1"):
        sessions.create_session(
            session_id,
            mode="recording",
            meta={
                "recording_mode": "dual",
                "company": "Example Co",
                "position": "Backend Engineer",
                "source_transcript": "Interviewer: Q? Candidate: A.",
            },
            user_id="user-a",
        )
        sessions.append_message(
            session_id,
            "user",
            "Interviewer: Q? Candidate: A.",
            user_id="user-a",
        )
        sessions.update_session_status(
            session_id, sessions.STATUS_REVIEWING, user_id="user-a"
        )

    def test_dual_recording_persists_questions_transcript_and_meta(self):
        self._create_recording_session()

        class FakeLLM:
            def __init__(self):
                self.calls = 0

            def invoke(self, _messages):
                self.calls += 1
                if self.calls == 1:
                    return SimpleNamespace(
                        content=json.dumps({
                            "qa_pairs": [{
                                "id": 1,
                                "question": "Q?",
                                "answer": "A.",
                                "focus_area": "Python",
                            }]
                        })
                    )
                return SimpleNamespace(
                    content=json.dumps({
                        "scores": [{"question_id": 1, "score": 8}],
                        "overall": {"avg_score": 8, "summary": "Good"},
                    })
                )

        async def no_behavior(*_args, **_kwargs):
            return []

        async def no_profile_update(*_args, **_kwargs):
            return None

        with (
            patch("backend.llm_provider.get_langchain_llm", return_value=FakeLLM()),
            patch("backend.memory.get_profile_summary", return_value=""),
            patch.object(recording, "extract_behavior_ops", no_behavior),
            patch.object(recording, "llm_update_profile", no_profile_update),
        ):
            recording._analyze_recording_background(
                "rec-1",
                "Interviewer: Q? Candidate: A.",
                "dual",
                "Example Co",
                "Backend Engineer",
                "user-a",
            )

        saved = sessions.get_session("rec-1", user_id="user-a")
        self.assertEqual(saved["status"], sessions.STATUS_REVIEWED)
        self.assertEqual(saved["questions"][0]["question"], "Q?")
        self.assertEqual([item["role"] for item in saved["transcript"]], ["assistant", "user"])
        self.assertEqual(saved["meta"]["recording_mode"], "dual")
        self.assertEqual(saved["meta"]["company"], "Example Co")

    def test_recording_failure_is_persisted_and_visible(self):
        self._create_recording_session("rec-failed")

        class FailingLLM:
            def invoke(self, _messages):
                raise RuntimeError("provider unavailable")

        with (
            patch("backend.llm_provider.get_langchain_llm", return_value=FailingLLM()),
            patch("backend.memory.get_profile_summary", return_value=""),
        ):
            with self.assertLogs(recording.logger, level="ERROR"):
                recording._analyze_recording_background(
                    "rec-failed",
                    "Interviewer: Q? Candidate: A.",
                    "dual",
                    None,
                    None,
                    "user-a",
                )

        saved = sessions.get_session("rec-failed", user_id="user-a")
        history = sessions.list_sessions(user_id="user-a")
        self.assertEqual(saved["status"], sessions.STATUS_REVIEW_FAILED)
        self.assertIn("provider unavailable", saved["review_error"])
        self.assertEqual(history["items"][0]["session_id"], "rec-failed")
        self.assertNotIn("source_transcript", history["items"][0]["meta"])

    def test_failed_recording_can_schedule_a_retry_from_persisted_input(self):
        self._create_recording_session("rec-retry")
        sessions.update_session_status(
            "rec-retry",
            sessions.STATUS_REVIEW_FAILED,
            user_id="user-a",
            review_error="first attempt failed",
        )
        saved = sessions.get_session("rec-retry", user_id="user-a")
        background = BackgroundTasks()

        result = interview._dispatch_review(
            "rec-retry", saved, "user-a", background
        )

        retried = sessions.get_session("rec-retry", user_id="user-a")
        self.assertEqual(result["status"], "pending")
        self.assertEqual(retried["status"], sessions.STATUS_REVIEWING)
        self.assertEqual(len(background.tasks), 1)


class ResumeInterviewContextTests(unittest.TestCase):
    def test_start_persists_and_passes_target_job_context_to_graph(self):
        class FakeGraph:
            def __init__(self):
                self.input = None

            async def ainvoke(self, graph_input, _config):
                self.input = graph_input
                return {"messages": [AIMessage(content="请先做个自我介绍。")]}

        graph = FakeGraph()
        request = StartInterviewRequest(
            mode=InterviewMode.RESUME,
            target_role="AI 应用开发工程师",
            job_description="负责 RAG 应用开发，要求熟悉 Python、向量检索和服务性能优化。",
        )

        with (
            patch(
                "backend.graphs.resume_interview.compile_resume_interview",
                return_value=graph,
            ),
            patch.object(interview, "update_target_role", new=AsyncMock()),
            patch.object(interview, "create_session") as create_session,
            patch.object(interview, "append_message"),
            patch.object(interview, "_graphs", {}),
        ):
            result = asyncio.run(interview.start_interview(request, user_id="user-a"))

        self.assertEqual(
            graph.input,
            {
                "target_role": "AI 应用开发工程师",
                "job_description": "负责 RAG 应用开发，要求熟悉 Python、向量检索和服务性能优化。",
            },
        )
        self.assertEqual(result["target_role"], "AI 应用开发工程师")
        self.assertEqual(result["job_description"], graph.input["job_description"])
        self.assertEqual(
            create_session.call_args.kwargs["meta"],
            {
                "target_role": "AI 应用开发工程师",
                "job_description": graph.input["job_description"],
            },
        )

    def test_resume_prompt_uses_job_description_and_preserves_it_in_state(self):
        class CapturingLLM:
            def __init__(self):
                self.messages = []

            async def ainvoke(self, messages):
                self.messages = messages
                return AIMessage(content="欢迎参加面试。")

        llm = CapturingLLM()
        init_node = resume_graph._make_init_interview("user-a")
        job_description = "负责高并发 API，要求掌握 FastAPI、PostgreSQL 和系统设计。"

        with (
            patch.object(resume_graph, "query_resume", return_value="候选人做过订单服务"),
            patch.object(resume_graph, "get_profile_summary", return_value="后端经验较强"),
            patch.object(resume_graph, "get_langchain_llm", return_value=llm),
        ):
            state = asyncio.run(
                init_node(
                    {
                        "target_role": "后端开发工程师",
                        "job_description": job_description,
                    }
                )
            )

        system_prompt = llm.messages[0].content
        self.assertIn("本次面试目标岗位 JD", system_prompt)
        self.assertIn(job_description, system_prompt)
        self.assertIn("候选人做过订单服务", system_prompt)
        self.assertEqual(state["job_description"], job_description)


class CopilotAuthorizationTests(unittest.TestCase):
    def test_invalid_websocket_token_is_rejected_before_accept(self):
        websocket = SimpleNamespace(
            accept=AsyncMock(),
            close=AsyncMock(),
        )

        asyncio.run(copilot.copilot_realtime_ws(websocket, "session-1", token="invalid"))

        websocket.accept.assert_not_awaited()
        websocket.close.assert_awaited_once_with(
            code=1008, reason="Authentication required"
        )

    def test_prep_lookup_is_scoped_to_authenticated_user(self):
        websocket = SimpleNamespace(send_json=AsyncMock())
        with patch.object(copilot.prep_store, "get_prep", return_value=None) as get_prep:
            with self.assertRaisesRegex(ValueError, "Prep session not ready"):
                asyncio.run(
                    copilot._init_copilot_session(
                        websocket,
                        "prep-1",
                        "session-1",
                        user_id="user-a",
                    )
                )
        get_prep.assert_called_once_with("prep-1", "user-a")


class SafePathTests(unittest.TestCase):
    def test_child_path_rejects_traversal_and_absolute_names(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self.assertEqual(
                safe_child_path(root, "resume.pdf"), root.resolve() / "resume.pdf"
            )
            with self.assertRaises(ValueError):
                safe_child_path(root, "../resume.pdf")
            with self.assertRaises(ValueError):
                safe_child_path(root, str(root / "resume.pdf"))


if __name__ == "__main__":
    unittest.main()
