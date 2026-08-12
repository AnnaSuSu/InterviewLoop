"""跨机器数据迁移：导出/导入用户数据为 tar.gz。

CLI (scripts/export_data.py、scripts/import_data.py) 与 HTTP 端点
(routers/data_migration.py) 共享这里的实现。

HTTP 侧通过 `rebind_user_id` 将归档中的数据全部归入当前登录用户，避免跨用户
泄露 / 错配；CLI 默认保留原 user_id 以支持管理员级整库迁移。
"""
from __future__ import annotations

import io
import json
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from backend.config import settings

SCHEMA_VERSION = 2
EXCLUDE_DIR_NAMES = {".index_cache", "__pycache__"}
SENSITIVE_USER_FILENAMES = {"provider.json", "voiceprint.json"}

# 与 storage/sessions.py 保持一致；目标库不存在时用它建表
_SESSIONS_DDL = """
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
    reference_answers TEXT DEFAULT '{}',
    review TEXT,
    status TEXT DEFAULT 'ongoing',
    review_error TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

_PERSONAL_DOCUMENTS_DDL = """
CREATE TABLE IF NOT EXISTS personal_documents (
    document_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'indexing',
    chunk_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

_PERSONAL_CONVERSATIONS_DDL = """
CREATE TABLE IF NOT EXISTS personal_conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    messages TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
"""

# Personal archives deliberately use a table whitelist. Derived vector/index tables,
# users/password hashes, and other accounts' data never enter a single-user backup.
_PERSONAL_DB_TABLES = {
    "sessions": {"ddl": _SESSIONS_DDL, "primary_key": "session_id"},
    "personal_documents": {
        "ddl": _PERSONAL_DOCUMENTS_DDL,
        "primary_key": "document_id",
    },
    "personal_conversations": {
        "ddl": _PERSONAL_CONVERSATIONS_DDL,
        "primary_key": "conversation_id",
    },
}


def _data_dir() -> Path:
    return settings.base_dir / "data"


def _db_path() -> Path:
    return settings.db_path


def _users_dir() -> Path:
    return _data_dir() / "users"


@dataclass
class ImportResult:
    db_inserted: int = 0
    db_skipped: int = 0
    files_copied: int = 0
    files_skipped: int = 0
    schema_version: int | None = None


def _filter_tar_member(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(tarinfo.name).parts
    if any(name in EXCLUDE_DIR_NAMES for name in parts):
        return None
    return tarinfo


def _personal_tar_filter(
    tarinfo: tarfile.TarInfo,
    *,
    include_sensitive_credentials: bool,
) -> tarfile.TarInfo | None:
    filtered = _filter_tar_member(tarinfo)
    if filtered is None:
        return None
    if (
        not include_sensitive_credentials
        and Path(tarinfo.name).name in SENSITIVE_USER_FILENAMES
    ):
        return None
    return tarinfo


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def _copy_user_table(
    src: sqlite3.Connection,
    dst: sqlite3.Connection,
    table: str,
    user_id: str,
) -> None:
    spec = _PERSONAL_DB_TABLES[table]
    dst.execute(spec["ddl"])
    if not _table_exists(src, table):
        return

    src_cols = [row[1] for row in src.execute(f"PRAGMA table_info({table})")]
    dst_cols = {row[1] for row in dst.execute(f"PRAGMA table_info({table})")}
    common = [column for column in src_cols if column in dst_cols]
    if spec["primary_key"] not in common or "user_id" not in common:
        raise RuntimeError(f"{table} 表缺少主键或 user_id，无法安全导出")

    columns = ", ".join(common)
    placeholders = ", ".join("?" for _ in common)
    rows = src.execute(
        f"SELECT {columns} FROM {table} WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    if rows:
        dst.executemany(
            f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
            rows,
        )


def _export_filtered_db(user_id: str, dst: Path) -> None:
    """Generate a personal DB containing only portable, user-owned tables.

    The live DB also contains password hashes and derived vector caches, so copying
    the whole DB and deleting rows afterward is not acceptable. Copy a strict
    whitelist and filter every table by user_id instead.
    """
    src_path = _db_path()
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()

    with closing(sqlite3.connect(str(src_path))) as src, \
         closing(sqlite3.connect(str(dst))) as dst_conn:
        for table in _PERSONAL_DB_TABLES:
            _copy_user_table(src, dst_conn, table, user_id)
        dst_conn.commit()
        dst_conn.execute("VACUUM")


def _export_full_db(dst: Path) -> None:
    """Create a transactionally consistent snapshot of the complete live DB."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    with closing(sqlite3.connect(str(_db_path()))) as src, \
         closing(sqlite3.connect(str(dst))) as dst_conn:
        src.backup(dst_conn)


def export_archive(
    output_path: Path,
    *,
    user_id: str | None = None,
    include_sensitive_credentials: bool = False,
) -> Path:
    """打包 data/ 为 tar.gz。

    user_id=None 表示导出全部用户（仅 CLI 用）；指定 user_id 时只导出该用户。
    返回 output_path（已确认写入完成）。
    """
    data_dir = _data_dir()
    if not data_dir.exists():
        raise FileNotFoundError(f"data 目录不存在: {data_dir}")

    output_path = Path(output_path).resolve()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.now().isoformat(timespec="seconds"),
        "user_id": user_id,
        "backup_kind": "personal" if user_id else "system",
        # Full-system backups always contain stored credentials. Personal backups
        # contain them only after explicit user opt-in.
        "includes_sensitive_credentials": (
            True if user_id is None else include_sensitive_credentials
        ),
        "source": str(data_dir),
    }

    tmp_db: Path | None = None
    db_source = _db_path()
    if db_source.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        tmp_db = output_path.parent / f".techspar-export-{ts}.db"
        if user_id:
            _export_filtered_db(user_id, tmp_db)
        else:
            _export_full_db(tmp_db)
        db_source = tmp_db

    try:
        with tarfile.open(output_path, "w:gz") as tar:
            manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
            info = tarfile.TarInfo("manifest.json")
            info.size = len(manifest_bytes)
            info.mtime = int(datetime.now().timestamp())
            tar.addfile(info, io.BytesIO(manifest_bytes))

            if db_source.exists():
                tar.add(db_source, arcname="data/interviews.db")

            users_dir = _users_dir()
            if users_dir.exists():
                if user_id:
                    udir = users_dir / user_id
                    if udir.exists():
                        tar.add(
                            udir,
                            arcname=f"data/users/{user_id}",
                            filter=lambda info: _personal_tar_filter(
                                info,
                                include_sensitive_credentials=include_sensitive_credentials,
                            ),
                        )
                else:
                    tar.add(users_dir, arcname="data/users", filter=_filter_tar_member)
    finally:
        if tmp_db and tmp_db.exists():
            tmp_db.unlink()

    return output_path


def _safe_extract(tar: tarfile.TarFile, dest: Path) -> None:
    dest_resolved = dest.resolve()
    for member in tar.getmembers():
        target = (dest / member.name).resolve()
        if not target.is_relative_to(dest_resolved):
            raise RuntimeError(f"archive 包含越界路径: {member.name}")
        if member.issym() or member.islnk():
            raise RuntimeError(f"archive 不允许链接条目: {member.name}")
    try:
        tar.extractall(dest, filter="data")
    except TypeError:
        tar.extractall(dest)


def _merge_personal_table(
    src: sqlite3.Connection,
    dst: sqlite3.Connection,
    table: str,
    *,
    strategy: str,
    rebind_user_id: str | None,
) -> tuple[int, int]:
    spec = _PERSONAL_DB_TABLES[table]
    dst.execute(spec["ddl"])
    if not _table_exists(src, table):
        return 0, 0

    src_cols = [row[1] for row in src.execute(f"PRAGMA table_info({table})")]
    dst_cols = {row[1] for row in dst.execute(f"PRAGMA table_info({table})")}
    common = [column for column in src_cols if column in dst_cols]
    primary_key = spec["primary_key"]
    if primary_key not in common or "user_id" not in common:
        raise RuntimeError(f"{table} 表缺少主键或 user_id，无法合并")

    rows = src.execute(f"SELECT {', '.join(common)} FROM {table}").fetchall()
    pk_idx = common.index(primary_key)
    uid_idx = common.index("user_id")
    inserted = 0
    skipped = 0

    for source_row in rows:
        row = list(source_row)
        if rebind_user_id is not None:
            row[uid_idx] = rebind_user_id
        primary_value = row[pk_idx]
        target_user_id = row[uid_idx]
        existing = dst.execute(
            f"SELECT user_id FROM {table} WHERE {primary_key} = ?",
            (primary_value,),
        ).fetchone()

        if existing:
            # A UUID collision must never let one account overwrite another.
            if existing[0] != target_user_id or strategy != "overwrite":
                skipped += 1
                continue
            set_cols = [column for column in common if column != primary_key]
            assignments = ", ".join(f"{column} = ?" for column in set_cols)
            values = [row[common.index(column)] for column in set_cols]
            dst.execute(
                f"UPDATE {table} SET {assignments} WHERE {primary_key} = ? AND user_id = ?",
                values + [primary_value, target_user_id],
            )
            inserted += 1
            continue

        placeholders = ", ".join("?" for _ in common)
        dst.execute(
            f"INSERT INTO {table} ({', '.join(common)}) VALUES ({placeholders})",
            row,
        )
        inserted += 1

    return inserted, skipped


def _merge_db(
    src_db: Path,
    dst_db: Path,
    *,
    strategy: str,
    rebind_user_id: str | None = None,
) -> tuple[int, int]:
    """Merge all portable personal tables, returning total (written, skipped).

    rebind_user_id 非空时，归档中所有行的 user_id 改写为该值——HTTP 导入用，
    防止跨用户写入；同时支持跨机迁移（user_id 在新机器上不同）。
    """
    if not dst_db.exists() and rebind_user_id is None:
        dst_db.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_db, dst_db)
        with sqlite3.connect(str(dst_db)) as c:
            total = sum(
                c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in _PERSONAL_DB_TABLES
                if _table_exists(c, table)
            )
        return total, 0

    dst_db.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(str(src_db))
    dst = sqlite3.connect(str(dst_db))
    try:
        inserted = 0
        skipped = 0
        for table in _PERSONAL_DB_TABLES:
            table_inserted, table_skipped = _merge_personal_table(
                src,
                dst,
                table,
                strategy=strategy,
                rebind_user_id=rebind_user_id,
            )
            inserted += table_inserted
            skipped += table_skipped
        dst.commit()
        return inserted, skipped
    finally:
        src.close()
        dst.close()


def _merge_users(
    src_users: Path,
    dst_users: Path,
    *,
    overwrite: bool,
    rebind_user_id: str | None = None,
) -> tuple[int, int]:
    """复制 data/users/ 下的文件。

    rebind_user_id 非空时，归档内任意 <some_id>/ 目录的内容都被写到
    <rebind_user_id>/ 下；用于 HTTP 导入将数据归到当前登录用户。
    """
    copied = 0
    skipped = 0
    for src_file in src_users.rglob("*"):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(src_users)
        if rebind_user_id is not None:
            parts = list(rel.parts)
            if not parts:
                continue
            parts[0] = rebind_user_id
            rel = Path(*parts)
        dst_file = dst_users / rel
        if dst_file.exists() and not overwrite:
            skipped += 1
            continue
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dst_file)
        copied += 1
    return copied, skipped


def import_archive(
    archive_path: Path,
    *,
    db_strategy: str = "skip",
    overwrite_files: bool = False,
    rebind_user_id: str | None = None,
    require_personal_archive: bool = False,
) -> ImportResult:
    """导入 export_archive 生成的 tar.gz。

    db_strategy: session_id 冲突时 'skip' 保留本地，'overwrite' 用归档覆盖。
    overwrite_files: 文件冲突时是否覆盖本地。
    rebind_user_id: HTTP 入口必传——把归档数据归到该 user_id。
    require_personal_archive: 仅接受 manifest.user_id 非空的单账户归档。
    """
    if db_strategy not in {"skip", "overwrite"}:
        raise ValueError("db_strategy 必须是 'skip' 或 'overwrite'")

    archive_path = Path(archive_path).resolve()
    if not archive_path.exists():
        raise FileNotFoundError(f"归档不存在: {archive_path}")

    result = ImportResult()

    with tempfile.TemporaryDirectory() as td_str:
        td = Path(td_str)
        with tarfile.open(archive_path, "r:gz") as tar:
            _safe_extract(tar, td)

        manifest_path = td / "manifest.json"
        manifest = None
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                result.schema_version = manifest.get("schema_version")
            except json.JSONDecodeError:
                manifest = None

        if require_personal_archive:
            source_user_id = manifest.get("user_id") if isinstance(manifest, dict) else None
            if not isinstance(source_user_id, str) or not source_user_id.strip():
                raise ValueError("仅支持带 user_id 的单账户备份，不能导入整站全量归档")

        data_dir = _data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)

        src_db = td / "data" / "interviews.db"
        if src_db.exists():
            ins, skip = _merge_db(
                src_db,
                _db_path(),
                strategy=db_strategy,
                rebind_user_id=rebind_user_id,
            )
            result.db_inserted = ins
            result.db_skipped = skip

        src_users = td / "data" / "users"
        if src_users.exists():
            copied, skipped = _merge_users(
                src_users,
                _users_dir(),
                overwrite=overwrite_files,
                rebind_user_id=rebind_user_id,
            )
            result.files_copied = copied
            result.files_skipped = skipped

    return result
