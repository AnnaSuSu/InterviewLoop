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

from backend import indexer, memory
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
    @staticmethod
    def _insert_reviewed_session(
        db_path: Path,
        session_id: str,
        user_id: str,
        *,
        mode: str,
        topic: str,
        score: float,
        created_at: str,
    ) -> None:
        with sqlite3.connect(db_path) as conn:
            conn.execute(data_migration._SESSIONS_DDL)
            conn.execute(
                "INSERT INTO sessions "
                "(session_id, mode, topic, scores, overall, review, status, user_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'reviewed', ?, ?)",
                (
                    session_id,
                    mode,
                    topic,
                    json.dumps([{"question_id": 1, "score": score}]),
                    json.dumps({"avg_score": score}),
                    "review",
                    user_id,
                    created_at,
                ),
            )

    def test_user_export_contains_only_their_portable_tables(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.db"
            exported = root / "exported.db"

            with sqlite3.connect(source) as conn:
                conn.execute(data_migration._SESSIONS_DDL)
                conn.execute(data_migration._PERSONAL_DOCUMENTS_DDL)
                conn.execute(data_migration._PERSONAL_CONVERSATIONS_DDL)
                conn.execute(
                    "INSERT INTO sessions (session_id, mode, user_id) VALUES (?, ?, ?)",
                    ("mine", "recording", "user-a"),
                )
                conn.execute(
                    "INSERT INTO sessions (session_id, mode, user_id) VALUES (?, ?, ?)",
                    ("theirs", "resume", "user-b"),
                )
                conn.execute(
                    "INSERT INTO personal_documents "
                    "(document_id, user_id, filename, stored_name, extension, size_bytes) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("doc-mine", "user-a", "mine.md", "doc-mine.md", ".md", 10),
                )
                conn.execute(
                    "INSERT INTO personal_documents "
                    "(document_id, user_id, filename, stored_name, extension, size_bytes) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    ("doc-theirs", "user-b", "theirs.md", "doc-theirs.md", ".md", 20),
                )
                conn.execute(
                    "INSERT INTO personal_conversations "
                    "(conversation_id, user_id, title) VALUES (?, ?, ?)",
                    ("chat-mine", "user-a", "My chat"),
                )
                conn.execute(
                    "INSERT INTO personal_conversations "
                    "(conversation_id, user_id, title) VALUES (?, ?, ?)",
                    ("chat-theirs", "user-b", "Their chat"),
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

                documents = conn.execute(
                    "SELECT document_id, user_id FROM personal_documents"
                ).fetchall()
                conversations = conn.execute(
                    "SELECT conversation_id, user_id FROM personal_conversations"
                ).fetchall()

            self.assertEqual(
                tables,
                {"sessions", "personal_documents", "personal_conversations"},
            )
            self.assertEqual(rows, [("mine", "user-a")])
            self.assertEqual(documents, [("doc-mine", "user-a")])
            self.assertEqual(conversations, [("chat-mine", "user-a")])

    def test_personal_archive_excludes_sensitive_credentials_by_default(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            db_path = root / "data" / "interviews.db"
            user_dir = root / "data" / "users" / "user-a"
            user_dir.mkdir(parents=True)
            db_path.parent.mkdir(parents=True, exist_ok=True)
            with sqlite3.connect(db_path) as conn:
                conn.execute(data_migration._SESSIONS_DDL)
            (user_dir / "profile").mkdir()
            (user_dir / "profile" / "profile.json").write_text('{"name":"A"}', encoding="utf-8")
            (user_dir / "resume").mkdir()
            (user_dir / "resume" / "resume.pdf").write_bytes(b"pdf")
            (user_dir / "knowledge" / "python").mkdir(parents=True)
            (user_dir / "knowledge" / "python" / "README.md").write_text("GIL", encoding="utf-8")
            (user_dir / "provider.json").write_text('{"api_key":"secret"}', encoding="utf-8")
            (user_dir / "voiceprint.json").write_text('{"secret_key":"secret"}', encoding="utf-8")
            (user_dir / "library").mkdir()
            (user_dir / "library" / "notes.md").write_text("notes", encoding="utf-8")

            default_archive = root / "personal-default.tar.gz"
            sensitive_archive = root / "personal-sensitive.tar.gz"
            with (
                patch.object(settings, "base_dir", root),
                patch.object(settings, "db_path", db_path),
            ):
                data_migration.export_archive(default_archive, user_id="user-a")
                data_migration.export_archive(
                    sensitive_archive,
                    user_id="user-a",
                    include_sensitive_credentials=True,
                )

            with tarfile.open(default_archive, "r:gz") as tar:
                default_names = set(tar.getnames())
                manifest = json.load(tar.extractfile("manifest.json"))
            with tarfile.open(sensitive_archive, "r:gz") as tar:
                sensitive_names = set(tar.getnames())

            prefix = "data/users/user-a"
            self.assertIn(f"{prefix}/profile/profile.json", default_names)
            self.assertIn(f"{prefix}/resume/resume.pdf", default_names)
            self.assertIn(f"{prefix}/knowledge/python/README.md", default_names)
            self.assertIn(f"{prefix}/library/notes.md", default_names)
            self.assertNotIn(f"{prefix}/provider.json", default_names)
            self.assertNotIn(f"{prefix}/voiceprint.json", default_names)
            self.assertIn(f"{prefix}/provider.json", sensitive_names)
            self.assertIn(f"{prefix}/voiceprint.json", sensitive_names)
            self.assertEqual(manifest["backup_kind"], "personal")
            self.assertFalse(manifest["includes_sensitive_credentials"])

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

    def test_http_personal_export_is_available_to_every_user(self):
        created_dir = None

        def fake_export(path, **kwargs):
            nonlocal created_dir
            created_dir = path.parent
            self.assertEqual(kwargs, {
                "user_id": "user-a",
                "include_sensitive_credentials": True,
            })
            path.write_bytes(b"personal archive")
            return path

        with patch.object(migration_router, "export_archive", side_effect=fake_export):
            response = migration_router.export_personal_data(
                BackgroundTasks(),
                include_sensitive=True,
                user_id="user-a",
            )

        self.assertTrue(Path(response.path).exists())
        self.assertIn("techspar-personal-", response.filename)
        if created_dir:
            migration_router._cleanup_dir(created_dir)

    def test_personal_archive_round_trip_rebinds_agent_data_and_files(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source_root = root / "source"
            target_root = root / "target"
            source_db = source_root / "data" / "interviews.db"
            target_db = target_root / "data" / "interviews.db"
            source_db.parent.mkdir(parents=True)

            with sqlite3.connect(source_db) as conn:
                conn.execute(data_migration._SESSIONS_DDL)
                conn.execute(data_migration._PERSONAL_DOCUMENTS_DDL)
                conn.execute(data_migration._PERSONAL_CONVERSATIONS_DDL)
                conn.execute(
                    "INSERT INTO sessions (session_id, mode, user_id) VALUES ('s1', 'resume', 'source-user')"
                )
                conn.execute(
                    "INSERT INTO personal_documents "
                    "(document_id, user_id, filename, stored_name, extension, size_bytes) "
                    "VALUES ('d1', 'source-user', 'notes.md', 'd1.md', '.md', 5)"
                )
                conn.execute(
                    "INSERT INTO personal_conversations "
                    "(conversation_id, user_id, title, messages) "
                    "VALUES ('c1', 'source-user', '成长计划', '[{\"role\":\"user\",\"content\":\"hi\"}]')"
                )

            source_user_dir = source_root / "data" / "users" / "source-user"
            (source_user_dir / "library").mkdir(parents=True)
            (source_user_dir / "library" / "d1.md").write_text("notes", encoding="utf-8")
            (source_user_dir / "profile").mkdir()
            (source_user_dir / "profile" / "profile.json").write_text(
                '{"name":"Source"}', encoding="utf-8"
            )
            archive = root / "personal.tar.gz"

            with (
                patch.object(settings, "base_dir", source_root),
                patch.object(settings, "db_path", source_db),
            ):
                data_migration.export_archive(archive, user_id="source-user")

            with (
                patch.object(settings, "base_dir", target_root),
                patch.object(settings, "db_path", target_db),
            ):
                result = data_migration.import_archive(
                    archive,
                    rebind_user_id="target-user",
                    require_personal_archive=True,
                )

            with sqlite3.connect(target_db) as conn:
                session_user = conn.execute(
                    "SELECT user_id FROM sessions WHERE session_id = 's1'"
                ).fetchone()[0]
                document_user = conn.execute(
                    "SELECT user_id FROM personal_documents WHERE document_id = 'd1'"
                ).fetchone()[0]
                conversation_user = conn.execute(
                    "SELECT user_id FROM personal_conversations WHERE conversation_id = 'c1'"
                ).fetchone()[0]

            self.assertEqual(result.db_inserted, 3)
            self.assertEqual(session_user, "target-user")
            self.assertEqual(document_user, "target-user")
            self.assertEqual(conversation_user, "target-user")
            self.assertEqual(
                (target_root / "data" / "users" / "target-user" / "library" / "d1.md").read_text(),
                "notes",
            )
            self.assertTrue(
                (
                    target_root
                    / "data"
                    / "users"
                    / "target-user"
                    / "profile"
                    / "profile.json"
                ).exists()
            )

    def test_personal_import_merges_existing_profile_and_rebuilds_stats(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source_root = root / "source"
            target_root = root / "target"
            source_db = source_root / "data" / "interviews.db"
            target_db = target_root / "data" / "interviews.db"
            source_db.parent.mkdir(parents=True)
            target_db.parent.mkdir(parents=True)

            self._insert_reviewed_session(
                source_db,
                "archive-session",
                "source-user",
                mode="topic_drill",
                topic="python",
                score=8,
                created_at="2026-08-11 10:00:00",
            )
            self._insert_reviewed_session(
                target_db,
                "local-session",
                "target-user",
                mode="resume",
                topic="python",
                score=6,
                created_at="2026-08-10 10:00:00",
            )

            source_profile = (
                source_root / "data" / "users" / "source-user" / "profile" / "profile.json"
            )
            target_profile = (
                target_root / "data" / "users" / "target-user" / "profile" / "profile.json"
            )
            source_profile.parent.mkdir(parents=True)
            target_profile.parent.mkdir(parents=True)
            source_profile.write_text(json.dumps({
                "name": "Archive Name",
                "target_role": "后端工程师",
                "stats": {"total_sessions": 1, "score_history": []},
                "weak_points": [
                    {
                        "point": "GIL 理解不深",
                        "topic": "python",
                        "first_seen": "2026-08-11T10:00:00",
                        "last_seen": "2026-08-11T10:00:00",
                        "times_seen": 1,
                        "improved": False,
                    }
                ],
                "strong_points": [],
                "behavior_signals": {
                    "reasoning.clear_tradeoff": {
                        "namespace": "reasoning",
                        "polarity": "positive",
                        "description": "能解释技术权衡",
                        "first_seen": "2026-08-11T10:00:00",
                        "last_seen": "2026-08-11T10:00:00",
                        "times_seen": 1,
                        "improved": False,
                    }
                },
                "topic_mastery": {"python": {"score": 70, "session_count": 1}},
            }, ensure_ascii=False), encoding="utf-8")
            target_profile.write_text(json.dumps({
                "name": "Local Name",
                "target_role": "",
                "stats": {"total_sessions": 1, "score_history": []},
                "weak_points": [
                    {
                        "point": "GC 原理薄弱",
                        "topic": "python",
                        "first_seen": "2026-08-10T10:00:00",
                        "last_seen": "2026-08-10T10:00:00",
                        "times_seen": 1,
                        "improved": False,
                    }
                ],
                "strong_points": [
                    {"point": "项目讲解清楚", "topic": "python", "first_seen": "2026-08-10T10:00:00"}
                ],
                "behavior_signals": {},
                "topic_mastery": {"python": {"score": 60, "session_count": 1}},
                "view_marker": {"at": "2026-08-10T11:00:00", "total_sessions": 1},
            }, ensure_ascii=False), encoding="utf-8")
            archive = root / "personal.tar.gz"

            with (
                patch.object(settings, "base_dir", source_root),
                patch.object(settings, "db_path", source_db),
            ):
                data_migration.export_archive(archive, user_id="source-user")

            with (
                patch.object(settings, "base_dir", target_root),
                patch.object(settings, "db_path", target_db),
            ):
                result = data_migration.import_archive(
                    archive,
                    rebind_user_id="target-user",
                    require_personal_archive=True,
                )

            merged = json.loads(target_profile.read_text(encoding="utf-8"))
            self.assertEqual(result.db_inserted, 1)
            self.assertEqual(merged["name"], "Local Name")
            self.assertEqual(merged["target_role"], "后端工程师")
            self.assertEqual(merged["stats"]["total_sessions"], 2)
            self.assertEqual(merged["stats"]["total_answers"], 2)
            self.assertEqual(merged["stats"]["avg_score"], 7.0)
            self.assertEqual(merged["stats"]["resume_sessions"], 1)
            self.assertEqual(merged["stats"]["drill_sessions"], 1)
            self.assertEqual(
                [entry["session_id"] for entry in merged["stats"]["score_history"]],
                ["local-session", "archive-session"],
            )
            self.assertEqual(
                {point["point"] for point in merged["weak_points"]},
                {"GC 原理薄弱", "GIL 理解不深"},
            )
            self.assertEqual(merged["strong_points"][0]["point"], "项目讲解清楚")
            self.assertIn("reasoning.clear_tradeoff", merged["behavior_signals"])
            self.assertEqual(merged["topic_mastery"]["python"]["session_count"], 2)
            self.assertEqual(merged["view_marker"]["total_sessions"], 1)

    def test_reimporting_personal_archive_is_idempotent_for_profile_stats(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source_root = root / "source"
            target_root = root / "target"
            source_db = source_root / "data" / "interviews.db"
            target_db = target_root / "data" / "interviews.db"
            source_db.parent.mkdir(parents=True)
            target_db.parent.mkdir(parents=True)
            self._insert_reviewed_session(
                source_db,
                "same-archive-session",
                "source-user",
                mode="topic_drill",
                topic="python",
                score=9,
                created_at="2026-08-11 10:00:00",
            )
            with sqlite3.connect(target_db) as conn:
                conn.execute(data_migration._SESSIONS_DDL)

            source_profile = (
                source_root / "data" / "users" / "source-user" / "profile" / "profile.json"
            )
            target_profile = (
                target_root / "data" / "users" / "target-user" / "profile" / "profile.json"
            )
            source_profile.parent.mkdir(parents=True)
            target_profile.parent.mkdir(parents=True)
            profile = {
                # The profile may legitimately remember practice whose history row
                # was deleted. Import must preserve this aggregate and stay idempotent.
                "stats": {"total_sessions": 5},
                "weak_points": [{"point": "GIL", "topic": "python", "times_seen": 1}],
                "strong_points": [],
                "behavior_signals": {},
                "topic_mastery": {},
            }
            source_profile.write_text(json.dumps(profile), encoding="utf-8")
            target_profile.write_text(json.dumps({
                "stats": {"total_sessions": 0},
                "weak_points": [],
                "strong_points": [],
                "behavior_signals": {},
                "topic_mastery": {},
            }), encoding="utf-8")
            archive = root / "personal.tar.gz"

            with (
                patch.object(settings, "base_dir", source_root),
                patch.object(settings, "db_path", source_db),
            ):
                data_migration.export_archive(archive, user_id="source-user")
            with (
                patch.object(settings, "base_dir", target_root),
                patch.object(settings, "db_path", target_db),
            ):
                first = data_migration.import_archive(
                    archive,
                    rebind_user_id="target-user",
                    require_personal_archive=True,
                )
                second = data_migration.import_archive(
                    archive,
                    overwrite_files=True,
                    rebind_user_id="target-user",
                    require_personal_archive=True,
                )

            merged = json.loads(target_profile.read_text(encoding="utf-8"))
            self.assertEqual((first.db_inserted, first.db_skipped), (1, 0))
            self.assertEqual((second.db_inserted, second.db_skipped), (0, 1))
            self.assertEqual(merged["stats"]["total_sessions"], 5)
            self.assertEqual(len(merged["stats"]["score_history"]), 1)
            self.assertEqual(len(merged["weak_points"]), 1)

    def test_personal_import_never_overwrites_another_users_id_collision(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source.db"
            target = root / "target.db"
            for path, user_id, mode in (
                (source, "source-user", "resume"),
                (target, "other-user", "recording"),
            ):
                with sqlite3.connect(path) as conn:
                    conn.execute(data_migration._SESSIONS_DDL)
                    conn.execute(
                        "INSERT INTO sessions (session_id, mode, user_id) VALUES (?, ?, ?)",
                        ("same-id", mode, user_id),
                    )

            inserted, skipped = data_migration._merge_db(
                source,
                target,
                strategy="overwrite",
                rebind_user_id="target-user",
            )

            with sqlite3.connect(target) as conn:
                row = conn.execute(
                    "SELECT mode, user_id FROM sessions WHERE session_id = 'same-id'"
                ).fetchone()
            self.assertEqual((inserted, skipped), (0, 1))
            self.assertEqual(row, ("recording", "other-user"))

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
                    return json.dumps({
                        "qa_pairs": [{
                            "id": 1,
                            "question": "Q?",
                            "answer": "A.",
                            "focus_area": "Python",
                        }]
                    })
                return json.dumps({
                    "scores": [{"question_id": 1, "score": 8}],
                    "overall": {"avg_score": 8, "summary": "Good"},
                })

        async def no_behavior(*_args, **_kwargs):
            return []

        async def no_profile_update(*_args, **_kwargs):
            return None

        with (
            patch("backend.llm_provider.get_llm", return_value=FakeLLM()),
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
            patch("backend.llm_provider.get_llm", return_value=FailingLLM()),
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
    def test_start_persists_and_passes_target_job_context_to_engine(self):
        captured = {}

        async def fake_start(session_id, user_id, target_role, job_description):
            captured["target_role"] = target_role
            captured["job_description"] = job_description
            return "请先做个自我介绍。"

        job_description = "负责 RAG 应用开发，要求熟悉 Python、向量检索和服务性能优化。"
        request = StartInterviewRequest(
            mode=InterviewMode.RESUME,
            target_role="AI 应用开发工程师",
            job_description=job_description,
        )

        with (
            patch.object(interview, "start_resume_interview", fake_start),
            patch.object(interview, "update_target_role", new=AsyncMock()),
            patch.object(interview, "create_session") as create_session,
            patch.object(interview, "append_message"),
        ):
            result = asyncio.run(interview.start_interview(request, user_id="user-a"))

        self.assertEqual(captured["target_role"], "AI 应用开发工程师")
        self.assertEqual(captured["job_description"], job_description)
        self.assertEqual(result["target_role"], "AI 应用开发工程师")
        self.assertEqual(result["message"], "请先做个自我介绍。")
        self.assertEqual(
            create_session.call_args.kwargs["meta"],
            {
                "target_role": "AI 应用开发工程师",
                "job_description": job_description,
            },
        )

    def test_resume_prompt_uses_job_description_and_preserves_it_in_state(self):
        class CapturingLLM:
            def __init__(self):
                self.messages = []

            async def ainvoke(self, messages):
                self.messages = messages
                return "欢迎参加面试。"

        llm = CapturingLLM()
        saved = {}
        job_description = "负责高并发 API，要求掌握 FastAPI、PostgreSQL 和系统设计。"

        def fake_save(session_id, state, *, user_id):
            saved["state"] = state

        with (
            patch.object(resume_graph, "load_resume_text", return_value="候选人做过订单服务") as load_resume,
            patch.object(resume_graph, "get_profile_summary", return_value="后端经验较强"),
            patch.object(resume_graph, "get_llm", return_value=llm),
            patch.object(resume_graph, "save_state", fake_save),
        ):
            opening = asyncio.run(
                resume_graph.start_interview("sess-1", "user-a", "后端开发工程师", job_description)
            )

        system_prompt = llm.messages[0]["content"]
        self.assertIn("本次面试目标岗位 JD", system_prompt)
        self.assertIn(job_description, system_prompt)
        self.assertIn("候选人做过订单服务", system_prompt)
        self.assertEqual(opening, "欢迎参加面试。")
        self.assertEqual(saved["state"]["job_description"], job_description)
        self.assertEqual(
            saved["state"]["messages"],
            [{"role": "assistant", "content": "欢迎参加面试。"}],
        )
        load_resume.assert_called_once_with("user-a")

    def test_take_turn_ends_after_reverse_qa_without_llm_call(self):
        state = {
            "messages": [],
            "phase": "reverse_qa",
            "phase_question_count": 2,
            "is_finished": False,
        }
        saved = {}

        def fake_save(session_id, st, *, user_id):
            saved["state"] = st

        with (
            patch.object(resume_graph, "save_state", fake_save),
            patch.object(resume_graph, "get_llm", side_effect=AssertionError("结束轮不应再调 LLM")),
        ):
            message, finished = asyncio.run(
                resume_graph.take_turn("sess-1", "user-a", state, "我没有其他问题了。")
            )

        self.assertEqual(message, "")
        self.assertTrue(finished)
        self.assertTrue(saved["state"]["is_finished"])

    def test_resume_text_is_loaded_verbatim_without_embedding(self):
        with tempfile.TemporaryDirectory() as td:
            resume_dir = Path(td)
            resume_path = resume_dir / "resume.PDF"
            resume_path.write_bytes(b"%PDF-placeholder")

            with (
                patch.object(type(settings), "user_resume_path", return_value=resume_dir),
                patch.object(indexer, "_read_pdf", return_value="  候选人完整简历\n项目 A\n项目 B  ") as read_pdf,
                patch.object(indexer, "get_embedding", side_effect=AssertionError("must not embed resume")),
            ):
                context = indexer.load_resume_text("user-a")

        self.assertEqual(context, "候选人完整简历\n项目 A\n项目 B")
        read_pdf.assert_called_once_with(resume_path)


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
