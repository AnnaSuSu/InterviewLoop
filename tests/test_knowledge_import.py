import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend import vector_memory
from backend.config import settings
from backend.indexer import load_topics
from backend.routers.knowledge import import_core_document


class KnowledgeImportTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "interviews.db"
        self.base_patch = patch.object(settings, "base_dir", self.root)
        self.db_patch = patch.object(settings, "db_path", self.db_path)
        self.vector_db_patch = patch.object(vector_memory, "DB_PATH", self.db_path)
        self.base_patch.start()
        self.db_patch.start()
        self.vector_db_patch.start()
        vector_memory.init_memory_table()

    def tearDown(self):
        self.vector_db_patch.stop()
        self.db_patch.stop()
        self.base_patch.stop()
        self.temp_dir.cleanup()

    def _topic_dir(self, topic: str, user_id: str) -> Path:
        topics = load_topics(user_id)
        return settings.user_knowledge_path(user_id) / topics[topic]["dir"]

    def test_markdown_import_keeps_source_verbatim(self):
        content = "# GC\n\n分代收集与常见回收器对比。"
        name = import_core_document("java", "GC 笔记.md", content.encode(), "user-a")

        self.assertEqual(name, "GC 笔记.md")
        saved = self._topic_dir("java", "user-a") / name
        self.assertEqual(saved.read_text(encoding="utf-8"), content)

    def test_docx_import_extracts_text_to_md(self):
        document_xml = (
            "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
            "<w:body><w:p><w:r><w:t>系统设计要点：先谈约束再谈方案。</w:t></w:r></w:p></w:body>"
            "</w:document>"
        )
        raw = self.root / "raw.docx"
        with zipfile.ZipFile(raw, "w") as archive:
            archive.writestr("word/document.xml", document_xml)

        name = import_core_document("java", "系统设计.docx", raw.read_bytes(), "user-a")

        self.assertEqual(name, "系统设计.md")
        saved = self._topic_dir("java", "user-a") / name
        self.assertIn("先谈约束再谈方案", saved.read_text(encoding="utf-8"))

    def test_traversal_in_filename_is_neutralized(self):
        name = import_core_document("java", "../../逃逸.md", "内容".encode(), "user-a")

        self.assertEqual(name, "逃逸.md")
        self.assertTrue((self._topic_dir("java", "user-a") / name).exists())

    def test_rejects_unknown_topic_unsupported_ext_and_empty_file(self):
        with self.assertRaises(ValueError):
            import_core_document("nope", "a.md", b"x", "user-a")
        with self.assertRaises(ValueError):
            import_core_document("java", "presentation.key", b"x", "user-a")
        with self.assertRaises(ValueError):
            import_core_document("java", "empty.md", b"", "user-a")

    def test_duplicate_target_name_raises(self):
        import_core_document("java", "重复.md", "第一次".encode(), "user-a")
        with self.assertRaises(FileExistsError):
            import_core_document("java", "重复.txt", "第二次".encode(), "user-a")


if __name__ == "__main__":
    unittest.main()
