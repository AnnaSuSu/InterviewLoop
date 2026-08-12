"""Data migration endpoints: personal portability plus admin system backup.

与 CLI (scripts/export_data.py、scripts/import_data.py) 共用
backend.storage.data_migration 中的核心实现。

Every account can export/import its own data. Administrators additionally have a
full-system backup. Personal imports always rebind data to the signed-in user.
"""
from __future__ import annotations

import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.auth import get_current_user, is_admin_user
from backend.storage.data_migration import (
    SCHEMA_VERSION,
    export_archive,
    import_archive,
)

router = APIRouter(prefix="/api/data")

# 单次上传的硬上限——防御性，避免临时盘被占满
MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB


def _cleanup_dir(path: Path) -> None:
    # 用 rmtree 而非 rmdir：Windows 下若残留文件，rmdir 会失败
    shutil.rmtree(path, ignore_errors=True)


@router.get("/export")
def export_data(
    background: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """管理员下载整站全量 tar.gz 备份。"""
    if not is_admin_user(user_id):
        raise HTTPException(403, "Only administrators can export system data")

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp_dir = Path(tempfile.mkdtemp(prefix="techspar-export-"))
    archive_path = tmp_dir / f"techspar-backup-{ts}.tar.gz"

    try:
        export_archive(archive_path)
    except FileNotFoundError as e:
        _cleanup_dir(tmp_dir)
        raise HTTPException(500, str(e))
    except Exception:
        _cleanup_dir(tmp_dir)
        raise

    background.add_task(_cleanup_dir, tmp_dir)

    return FileResponse(
        archive_path,
        media_type="application/gzip",
        filename=archive_path.name,
    )


@router.get("/export/personal")
def export_personal_data(
    background: BackgroundTasks,
    include_sensitive: bool = False,
    user_id: str = Depends(get_current_user),
):
    """Download the current user's portable backup.

    Provider/API keys and voiceprint credentials are excluded unless the user
    explicitly opts in with include_sensitive=true.
    """
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp_dir = Path(tempfile.mkdtemp(prefix="techspar-personal-export-"))
    archive_path = tmp_dir / f"techspar-personal-{ts}.tar.gz"

    try:
        export_archive(
            archive_path,
            user_id=user_id,
            include_sensitive_credentials=include_sensitive,
        )
    except FileNotFoundError as exc:
        _cleanup_dir(tmp_dir)
        raise HTTPException(500, str(exc))
    except Exception:
        _cleanup_dir(tmp_dir)
        raise

    background.add_task(_cleanup_dir, tmp_dir)
    return FileResponse(
        archive_path,
        media_type="application/gzip",
        filename=archive_path.name,
    )


@router.post("/import")
async def import_data(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    db_strategy: str = Form("skip"),
    overwrite_files: bool = Form(False),
    user_id: str = Depends(get_current_user),
):
    """导入单账户备份归档。所有数据归到当前登录用户。"""
    if db_strategy not in {"skip", "overwrite"}:
        raise HTTPException(400, "db_strategy 必须是 'skip' 或 'overwrite'")

    filename = file.filename or "upload"
    if not (filename.endswith(".tar.gz") or filename.endswith(".tgz")):
        raise HTTPException(400, "仅支持 .tar.gz / .tgz 归档")

    tmp_dir = Path(tempfile.mkdtemp(prefix="techspar-import-"))
    archive_path = tmp_dir / "upload.tar.gz"

    total = 0
    try:
        with archive_path.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"归档过大（上限 {MAX_UPLOAD_BYTES // 1024 // 1024} MB）")
                out.write(chunk)

        try:
            result = import_archive(
                archive_path,
                db_strategy=db_strategy,
                overwrite_files=overwrite_files,
                rebind_user_id=user_id,
                require_personal_archive=True,
            )
        except (RuntimeError, ValueError) as e:
            raise HTTPException(400, f"归档解析失败: {e}")

        # Vectors are derived and intentionally absent from personal archives.
        # Drop any stale local cache and make the rebuild requirement visible.
        from backend.indexer import invalidate_user_embeddings
        from backend.personal_agent import mark_documents_for_reindex

        invalidate_user_embeddings(user_id)
        mark_documents_for_reindex(user_id)
    finally:
        background.add_task(_cleanup_dir, tmp_dir)

    return {
        "ok": True,
        "schema_version": result.schema_version,
        "current_schema_version": SCHEMA_VERSION,
        "db_inserted": result.db_inserted,
        "db_skipped": result.db_skipped,
        "files_copied": result.files_copied,
        "files_skipped": result.files_skipped,
        "requires_reindex": True,
    }
