"""Resume and speech-to-text routes."""

import asyncio
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from langchain_core.messages import HumanMessage, SystemMessage

from backend.auth import get_current_user
from backend.config import settings
from backend.indexer import _read_pdf, invalidate_resume
from backend.llm_provider import get_langchain_llm
from backend.prompts.resume_import import RESUME_PARSE_PROMPT
from backend.utils import parse_json_response, safe_child_path

logger = logging.getLogger("uvicorn")

router = APIRouter(prefix="/api")
MAX_RESUME_BYTES = 20 * 1024 * 1024
# 超长简历截断,避免撑爆上下文;正常简历远小于这个数
MAX_PARSE_CHARS = 20000


def _find_resume_pdf(user_id: str) -> Path | None:
    resume_dir = settings.user_resume_path(user_id)
    if not resume_dir.exists():
        return None
    files = [file for file in resume_dir.iterdir() if file.suffix.lower() == ".pdf"]
    return files[0] if files else None


@router.get("/resume/status")
def resume_status(user_id: str = Depends(get_current_user)):
    """Check if a resume file exists."""
    resume_file = _find_resume_pdf(user_id)
    if resume_file is None:
        return {"has_resume": False}
    return {
        "has_resume": True,
        "filename": resume_file.name,
        "size": resume_file.stat().st_size,
    }


@router.get("/resume/file")
def resume_file(user_id: str = Depends(get_current_user)):
    """Serve the uploaded resume PDF (for in-app preview / download)."""
    pdf = _find_resume_pdf(user_id)
    if pdf is None:
        raise HTTPException(404, "还没有上传过简历")
    return FileResponse(pdf, media_type="application/pdf", filename=pdf.name)


@router.delete("/resume")
def delete_resume(user_id: str = Depends(get_current_user)):
    """Delete the uploaded resume PDF and its vectors."""
    pdf = _find_resume_pdf(user_id)
    if pdf is None:
        raise HTTPException(404, "还没有上传过简历")
    pdf.unlink()
    invalidate_resume(user_id)
    return {"ok": True}


@router.post("/resume/parse")
async def parse_resume(user_id: str = Depends(get_current_user)):
    """用用户自配的 LLM 把已上传的简历 PDF 解析成结构化 JSON(简历管理「解析为模板简历」)。"""
    pdf = _find_resume_pdf(user_id)
    if pdf is None:
        raise HTTPException(400, "请先上传简历")

    text = (await asyncio.to_thread(_read_pdf, pdf)).strip()
    if not text:
        raise HTTPException(500, "无法从 PDF 提取文本(可能是扫描件或图片型简历)")

    # ProviderNotConfigured 由全局 handler 转 400 引导配置,这里不拦
    llm = get_langchain_llm(user_id)
    prompt = RESUME_PARSE_PROMPT.format(resume_text=text[:MAX_PARSE_CHARS])
    messages = [
        SystemMessage(content="你是简历解析引擎。只返回 JSON，不要其他内容。"),
        HumanMessage(content=prompt),
    ]

    # 解析失败重试一次,与画像提取的做法一致
    parsed = None
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = await asyncio.to_thread(llm.invoke, messages)
            candidate = parse_json_response(response.content)
            if not isinstance(candidate, dict):
                raise ValueError(f"expected dict, got {type(candidate)}")
            parsed = candidate
            break
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            logger.warning(f"Resume parse failed (attempt {attempt + 1}/2): {exc}")

    if parsed is None:
        logger.error(f"Resume parse gave up: {last_error}")
        raise HTTPException(500, "简历解析失败，请重试")

    return {"ok": True, "parsed": parsed}


@router.post("/resume/upload")
async def upload_resume(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    """Upload a resume PDF. Replaces any existing resume."""
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    resume_dir = settings.user_resume_path(user_id)
    resume_dir.mkdir(parents=True, exist_ok=True)
    try:
        dest = safe_child_path(resume_dir, filename)
    except ValueError:
        raise HTTPException(400, "Invalid resume filename.")

    content = await file.read(MAX_RESUME_BYTES + 1)
    if len(content) > MAX_RESUME_BYTES:
        raise HTTPException(413, "Resume PDF is too large (max 20 MB).")
    if b"%PDF-" not in content[:1024]:
        raise HTTPException(400, "Uploaded file is not a valid PDF.")

    temp = resume_dir / f".{uuid.uuid4().hex}.upload"
    try:
        temp.write_bytes(content)
        for old in resume_dir.iterdir():
            if old.is_file() and old.suffix.lower() == ".pdf":
                old.unlink()
        temp.replace(dest)
    finally:
        if temp.exists():
            temp.unlink()

    # Drop stale resume vectors; the next query_resume lazily re-ingests the new PDF.
    invalidate_resume(user_id)

    return {"ok": True, "filename": filename, "size": len(content)}


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    """Transcribe short audio clip to text via DashScope ASR."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file.")

    try:
        from backend.transcribe import transcribe_short

        suffix = "." + (file.filename or "audio.webm").rsplit(".", 1)[-1]
        text = await asyncio.to_thread(transcribe_short, audio_bytes, suffix=suffix)
        return {"text": text}
    except Exception as exc:
        raise HTTPException(500, f"Transcription failed: {exc}")
