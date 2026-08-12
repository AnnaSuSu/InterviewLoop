"""Personal growth Agent and document-library routes."""
import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend.auth import get_current_user
from backend.models import PersonalAgentChatRequest
from backend.personal_agent import (
    MAX_UPLOAD_BYTES,
    SUPPORTED_EXTENSIONS,
    chat_with_personal_agent,
    create_document,
    delete_conversation,
    delete_document,
    get_conversation,
    list_conversations,
    list_documents,
)

router = APIRouter(prefix="/api/personal-agent")


@router.get("/documents")
def get_documents(user_id: str = Depends(get_current_user)):
    return {
        "items": list_documents(user_id),
        "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
        "max_upload_bytes": MAX_UPLOAD_BYTES,
    }


@router.post("/documents")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    try:
        return await asyncio.to_thread(create_document, file.filename or "document", content, user_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.delete("/documents/{document_id}")
def remove_document(document_id: str, user_id: str = Depends(get_current_user)):
    if not delete_document(document_id, user_id):
        raise HTTPException(404, "文档不存在")
    return {"ok": True}


@router.get("/conversations")
def get_conversations(user_id: str = Depends(get_current_user)):
    return {"items": list_conversations(user_id)}


@router.get("/conversations/{conversation_id}")
def get_conversation_detail(conversation_id: str, user_id: str = Depends(get_current_user)):
    conversation = get_conversation(conversation_id, user_id)
    if not conversation:
        raise HTTPException(404, "对话不存在")
    return conversation


@router.delete("/conversations/{conversation_id}")
def remove_conversation(conversation_id: str, user_id: str = Depends(get_current_user)):
    if not delete_conversation(conversation_id, user_id):
        raise HTTPException(404, "对话不存在")
    return {"ok": True}


@router.post("/chat")
async def personal_agent_chat(
    payload: PersonalAgentChatRequest,
    user_id: str = Depends(get_current_user),
):
    message = payload.message.strip()
    if not message:
        raise HTTPException(400, "消息不能为空")
    try:
        return await asyncio.to_thread(
            chat_with_personal_agent,
            message,
            user_id,
            payload.conversation_id,
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc))
