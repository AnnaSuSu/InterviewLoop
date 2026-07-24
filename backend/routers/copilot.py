"""Copilot prep and realtime websocket routes."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, WebSocket, WebSocketDisconnect
from langchain_core.messages import HumanMessage

from backend.auth import get_current_user
from backend.llm_provider import resolve_dashscope_key
from backend.memory import llm_update_profile
from backend.runtime import _copilot_sessions
from backend.storage import copilot_preps as prep_store

logger = logging.getLogger("uvicorn")
rest_router = APIRouter(prefix="/api")
ws_router = APIRouter()


async def _update_copilot_profile(fit_report: dict, position: str, user_id: str):
    """Write high-risk gaps from copilot fit analysis back to profile as predicted weak points."""
    if not isinstance(fit_report, dict):
        return

    gaps = fit_report.get("gaps", [])
    high_risk_gaps = [gap for gap in gaps if isinstance(gap, dict) and gap.get("risk") == "high"]
    if not high_risk_gaps:
        return

    new_weak_points = [
        {"point": gap["point"], "topic": position or "综合", "source": "predicted"}
        for gap in high_risk_gaps if gap.get("point")
    ]

    await llm_update_profile(
        mode="copilot",
        topic=position or None,
        new_weak_points=new_weak_points,
        new_strong_points=[],
        topic_mastery={},
        user_id=user_id,
        session_summary=f"Copilot JD分析: {position}",
    )


@rest_router.post("/copilot/prep")
async def start_copilot_prep(
    background_tasks: BackgroundTasks,
    jd_text: str = Form(...),
    company: str = Form(""),
    position: str = Form(""),
    user_id: str = Depends(get_current_user),
):
    """启动 Copilot Prep Phase（后台异步执行）。"""
    prep_id = uuid.uuid4().hex[:12]
    prep_store.create_prep(prep_id, user_id, company, position, jd_text)

    async def _run_prep():
        from backend.graphs.copilot_prep import run_copilot_prep

        try:
            async def on_progress(text):
                prep_store.update_progress(prep_id, text)

            result = await run_copilot_prep(
                jd_text=jd_text,
                user_id=user_id,
                company=company,
                position=position,
                on_progress=on_progress,
            )
            prep_store.set_done(prep_id, result)
            try:
                await _update_copilot_profile(result.get("fit_report", {}), position, user_id)
            except Exception as exc:
                logger.warning("Copilot profile write-back failed: %s", exc)
        except Exception as exc:
            logger.error("Copilot prep failed: %s", exc, exc_info=True)
            prep_store.set_error(prep_id, str(exc))

    background_tasks.add_task(_run_prep)
    return {"prep_id": prep_id}


@rest_router.get("/copilot/preps")
async def list_copilot_preps(user_id: str = Depends(get_current_user)):
    """列出当前用户的所有 Copilot Prep 会话。"""
    rows = prep_store.list_preps(user_id)
    return [
        {
            "prep_id": row["prep_id"],
            "company": row["company"],
            "position": row["position"],
            "jd_excerpt": row["jd_text"][:80],
            "status": row["status"],
            "progress": row["progress"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


@rest_router.delete("/copilot/prep/{prep_id}")
async def delete_copilot_prep(prep_id: str, user_id: str = Depends(get_current_user)):
    """删除一个 Copilot Prep 会话。"""
    if not prep_store.delete_prep(prep_id, user_id):
        raise HTTPException(404, "Prep session not found")
    return {"ok": True}


@rest_router.get("/copilot/prep/{prep_id}")
async def get_copilot_prep_status(prep_id: str, user_id: str = Depends(get_current_user)):
    """查询 Copilot Prep 进度和结果。"""
    data = prep_store.get_prep(prep_id, user_id)
    if not data:
        raise HTTPException(404, "Prep session not found")

    resp = {
        "status": data["status"],
        "progress": data["progress"],
        "error": data.get("error", ""),
        "company": data.get("company", ""),
        "position": data.get("position", ""),
    }
    if data["status"] == "done" and data.get("result"):
        result = data["result"]
        resp["company_report"] = result.get("company_report", "")
        resp["jd_analysis"] = result.get("jd_analysis", {})
        resp["fit_report"] = result.get("fit_report", {})
        resp["risk_map"] = result.get("risk_map", [])
        resp["risk_summary"] = result.get("risk_summary", "")
        resp["prep_hints"] = result.get("prep_hints", [])
    return resp


@rest_router.get("/copilot/prep/{prep_id}/tree")
async def get_copilot_strategy_tree(prep_id: str, user_id: str = Depends(get_current_user)):
    """获取策略树（前端可视化用）。"""
    data = prep_store.get_prep(prep_id, user_id)
    if not data or data["status"] != "done" or not data.get("result"):
        raise HTTPException(404, "Prep not ready")
    return data["result"].get("question_strategy_tree", {})


@ws_router.websocket("/ws/copilot/{session_id}")
async def copilot_realtime_ws(ws: WebSocket, session_id: str, token: str = ""):
    """Copilot 实时面试辅助 WebSocket。"""
    from backend.auth import decode_token
    from backend.user_context import reset_current_user, set_current_user

    user_id = decode_token(token) if token else None
    if not user_id:
        await ws.close(code=1008, reason="Authentication required")
        return

    await ws.accept()
    session = None
    # Bind user for this connection — realtime copilot subsystem resolves its
    # LLM/embedding via the ContextVar (create_task tasks copy the context).
    user_token = set_current_user(user_id)

    try:
        while True:
            data = await ws.receive()

            if data.get("type") == "websocket.receive" and data.get("bytes"):
                if session and session.get("asr"):
                    session["asr"].send_audio(data["bytes"])
                continue

            raw = data.get("text", "")
            if not raw:
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")
            if msg_type == "start":
                try:
                    session = await _init_copilot_session(
                        ws,
                        msg.get("prep_id", ""),
                        session_id,
                        user_id=user_id,
                    )
                    _copilot_sessions[session_id] = session
                    await ws.send_json({"type": "started", "session_id": session_id})
                    asyncio.create_task(_run_warmup(ws))
                except Exception as exc:
                    logger.error("Copilot session init failed: %s", exc, exc_info=True)
                    await ws.send_json({"type": "error", "message": f"初始化失败: {exc}"})

            elif msg_type == "manual" and session:
                text = msg.get("text", "").strip()
                if text:
                    await _process_utterance(ws, session, text, role="hr")

            elif msg_type == "candidate_response" and session:
                text = msg.get("text", "").strip()
                if text:
                    await _process_utterance(ws, session, text, role="candidate")

            elif msg_type == "stop":
                if session and session.get("asr"):
                    await session["asr"].stop()
                await ws.send_json({"type": "stopped"})
                break

    except WebSocketDisconnect:
        logger.info("Copilot WS disconnected: %s", session_id)
    except RuntimeError as exc:
        if "disconnect" in str(exc).lower():
            logger.info("Copilot WS disconnected: %s", session_id)
        else:
            logger.error("Copilot WS runtime error: %s", exc, exc_info=True)
    except Exception as exc:
        logger.error("Copilot WS error: %s", exc, exc_info=True)
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if session and session.get("asr"):
            try:
                await session["asr"].shutdown()
            except Exception:
                pass
        _copilot_sessions.pop(session_id, None)
        reset_current_user(user_token)


async def _init_copilot_session(
    ws: WebSocket,
    prep_id: str,
    session_id: str,
    *,
    user_id: str,
) -> dict:
    """初始化 Copilot 实时会话。"""
    from backend.copilot import voiceprint_store
    from backend.copilot.strategy_tree import StrategyTreeNavigator

    prep_data = prep_store.get_prep(prep_id, user_id)
    if not prep_data or prep_data["status"] != "done" or not prep_data.get("result"):
        raise ValueError("Prep session not ready")

    prep_result = prep_data["result"]
    tree = prep_result.get("question_strategy_tree", {})

    navigator = StrategyTreeNavigator(tree)
    await ws.send_json({"type": "progress", "message": "正在预计算策略树 embedding..."})
    await navigator.precompute_embeddings()

    vp_client = None
    vp_id = None
    vp_enabled = False
    if user_id:
        vp_client = voiceprint_store.get_client(user_id)
        vp_id = voiceprint_store.get_voice_print_id(user_id)
        vp_enabled = bool(vp_client and vp_id)

    asr = None
    dashscope_key = resolve_dashscope_key(user_id)
    if dashscope_key:
        try:
            from backend.copilot.asr_stream import CopilotASR

            loop = asyncio.get_event_loop()
            asr = CopilotASR(
                loop,
                api_key=dashscope_key,
                voiceprint_client=vp_client if vp_enabled else None,
                voice_print_id=vp_id if vp_enabled else None,
            )

            async def on_interim(text):
                try:
                    await ws.send_json({"type": "asr_interim", "text": text})
                except Exception:
                    pass

            async def on_sentence_end(text):
                try:
                    current_session = _copilot_sessions.get(session_id, {})
                    role = "hr"
                    if asr is not None:
                        detected = asr.lookup_role_now()
                        if detected:
                            role = detected
                    await ws.send_json({"type": "asr_final", "text": text, "role": role})
                    await _process_utterance(ws, current_session, text, role=role)
                except Exception as exc:
                    logger.error("ASR sentence processing failed: %s", exc)

            async def on_error(message):
                try:
                    await ws.send_json({"type": "error", "message": f"ASR: {message}"})
                except Exception:
                    pass

            asr.on_interim = on_interim
            asr.on_sentence_end = on_sentence_end
            asr.on_error = on_error
            await asr.start()
            ready_msg = "语音识别 + 声纹自动识别已就绪" if vp_enabled else "语音识别已就绪"
            await ws.send_json({"type": "progress", "message": ready_msg})
        except Exception as exc:
            logger.warning("ASR init failed (will use manual input): %s", exc)
            asr = None
            await ws.send_json({"type": "progress", "message": "语音识别不可用，请使用手动输入"})
    else:
        await ws.send_json({"type": "progress", "message": "未配置 DashScope API Key，请使用手动输入"})

    return {
        "asr": asr,
        "navigator": navigator,
        "prep": prep_result,
        "conversation": [],
        "last_node_id": None,
        "turn_count": 0,
        "voiceprint_enabled": vp_enabled,
    }


async def _process_utterance(ws: WebSocket, session: dict, text: str, *, role: str = "hr"):
    """处理一句话（HR 提问或候选人自述）。"""
    if not session:
        return

    conversation = session.get("conversation", [])
    if role == "candidate":
        conversation.append({"role": "candidate", "text": text})
        asyncio.create_task(_run_interview_monitor(ws, session))
        return

    from backend.copilot import hr_profiler
    from backend.copilot.answer_advisor import prepare_advice_context, stream_advice
    from backend.copilot.intent_classifier import classify_intent

    navigator = session.get("navigator")
    prep = session.get("prep", {})

    conversation.append({"role": "hr", "text": text})
    session["turn_count"] = session.get("turn_count", 0) + 1

    intent_result = await classify_intent(text, navigator, last_node_id=session.get("last_node_id"))
    node_id = intent_result.get("node_id")
    intent = intent_result.get("intent", "unknown")
    if node_id:
        session["last_node_id"] = node_id

    node = navigator.get_node(node_id) if node_id else None
    children_list = []
    recommended_points = []
    prep_hint = None
    if node:
        children = navigator.get_children(node_id)
        children_list = [
            {"topic": child.get("topic", ""), "question": (child.get("sample_questions") or [""])[0]}
            for child in children
        ]
        recommended_points = node.get("recommended_points", [])
        for hint in prep.get("prep_hints", []):
            if hint.get("node_id") == node_id:
                prep_hint = hint
                break

    ctx = prepare_advice_context(text, node_id, navigator, prep, conversation=conversation)
    await ws.send_json({
        "type": "copilot_update",
        "intent": intent,
        "tree_position": node_id,
        "topic": node.get("topic", "") if node else "",
        "confidence": intent_result.get("confidence", 0),
        "recommended_points": recommended_points,
        "children": children_list,
        "prep_hint": {
            "safe_talking_points": prep_hint.get("safe_talking_points", []),
            "redirect_suggestion": prep_hint.get("redirect_suggestion", ""),
        } if prep_hint else None,
    })

    if ctx["risk_alert"]:
        await ws.send_json({
            "type": "risk_alert",
            "message": ctx["risk_alert"],
            "node_id": node_id,
        })

    async def run_answer_coach():
        async for item in stream_advice(ctx["prompt"]):
            if item["type"] == "chunk":
                await ws.send_json({"type": "answer_chunk", "text": item["text"]})
            elif item["type"] == "meta":
                await ws.send_json({"type": "answer_meta", "first_token_ms": item["first_token_ms"]})
            elif item["type"] == "done":
                await ws.send_json({
                    "type": "answer_done",
                    "total_ms": item.get("total_ms"),
                    "chunk_count": item.get("chunk_count"),
                })

    if hr_profiler.should_run(session["turn_count"]):
        asyncio.create_task(_run_hr_profiler(ws, session))
    asyncio.create_task(_run_interview_monitor(ws, session))

    await run_answer_coach()


async def _run_warmup(ws: WebSocket):
    """连接后自动测一次 LLM 速度。"""
    import time

    from backend.llm_provider import get_copilot_llm

    try:
        llm = get_copilot_llm(streaming=True)
        start = time.monotonic()
        chunk_count = 0
        first_token_ms = None
        async for chunk in llm.astream([HumanMessage(content="说一个字：好")]):
            if chunk.content:
                chunk_count += 1
                if chunk_count == 1:
                    first_token_ms = round((time.monotonic() - start) * 1000)
        total_ms = round((time.monotonic() - start) * 1000)
        await ws.send_json({"type": "answer_meta", "first_token_ms": first_token_ms or total_ms})
        await ws.send_json({"type": "answer_done", "total_ms": total_ms, "chunk_count": chunk_count})
        logger.info("Warmup: first_token=%sms total=%sms", first_token_ms, total_ms)
    except Exception as exc:
        logger.warning("Warmup failed: %s", exc)


async def _run_hr_profiler(ws: WebSocket, session: dict):
    """后台运行 HR Profiler，完成后推送结果。"""
    from backend.copilot.hr_profiler import analyze_hr

    try:
        result = await analyze_hr(session.get("conversation", []))
        if result:
            await ws.send_json({"type": "hr_profile_update", **result})
    except Exception as exc:
        logger.error("HR Profiler task error: %s", exc)


async def _run_interview_monitor(ws: WebSocket, session: dict):
    """后台运行 Interview Monitor，完成后推送结果。"""
    from backend.copilot.interview_monitor import analyze_interview

    try:
        result = await analyze_interview(session.get("conversation", []), session.get("prep", {}))
        if result:
            await ws.send_json({"type": "monitor_update", **result})
    except Exception as exc:
        logger.error("Interview Monitor task error: %s", exc)
