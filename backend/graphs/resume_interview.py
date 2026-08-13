"""模式1: 简历模拟面试 — 显式状态机。

每轮: 追加用户回答 → 路由(继续问 / 进入下一阶段 / 结束) → 至多一次 LLM 调用
生成下一问 → 状态整体落盘(SQLite,resume_interview_state 表)。
messages 为 OpenAI 格式 [{"role", "content"}],只含 user/assistant 轮次。
"""
import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator

from backend.models import ResumeInterviewState, InterviewPhase
from backend.config import settings
from backend.llm_provider import AIMessage, HumanMessage, SystemMessage, get_llm
from backend.indexer import load_resume_text
from backend.memory import get_profile_summary
from backend.prompts.interviewer import RESUME_INTERVIEWER_SYSTEM
from backend.storage.interview_state import save_state

logger = logging.getLogger("uvicorn")

PHASE_ORDER = [
    InterviewPhase.GREETING.value,
    InterviewPhase.SELF_INTRO.value,
    InterviewPhase.TECHNICAL.value,
    InterviewPhase.PROJECT_DEEP_DIVE.value,
    InterviewPhase.BEHAVIORAL.value,
    InterviewPhase.REVERSE_QA.value,
]

# Phases that carry inline EVAL and use eval-driven advancement.
SCORED_PHASES = ("technical", "project_deep_dive", "behavioral")

# Hard ceiling per phase to prevent infinite loops
HARD_MAX_PER_PHASE = 10

_EVAL_PATTERN = re.compile(r"<!--EVAL:(.*?)-->", re.DOTALL)


def _parse_inline_eval(content: str) -> tuple[str, dict | None]:
    """Extract and strip hidden eval JSON from interviewer response.

    Returns (clean_content, eval_dict_or_None).
    """
    m = _EVAL_PATTERN.search(content)
    if not m:
        return content, None

    clean = _EVAL_PATTERN.sub("", content).rstrip()
    try:
        eval_data = json.loads(m.group(1))
        return clean, eval_data
    except json.JSONDecodeError:
        logger.warning(f"Failed to parse inline eval: {m.group(1)[:100]}")
        return clean, None


async def _system_prompt(state: ResumeInterviewState, user_id: str) -> str:
    """Interviewer system prompt for the current phase."""
    asked = state.get("questions_asked", [])
    asked_str = "\n".join(f"- {q}" for q in asked) if asked else "无"
    profile_summary = await asyncio.to_thread(get_profile_summary, user_id)
    job_description = (state.get("job_description") or "").strip()
    return RESUME_INTERVIEWER_SYSTEM.format(
        target_role=(state.get("target_role") or "").strip() or "候选人应聘岗位",
        job_description=job_description or "未提供岗位 JD，请主要结合目标岗位和候选人简历进行面试。",
        resume_context=state.get("resume_context", ""),
        phase=state.get("phase", "technical"),
        asked_questions=asked_str,
        user_profile=profile_summary,
    )


async def start_interview(
    session_id: str, user_id: str, target_role: str, job_description: str,
) -> str:
    """初始化状态并生成面试官开场白,落盘后返回开场白文本。"""
    resume_ctx = await asyncio.to_thread(load_resume_text, user_id)
    state: ResumeInterviewState = {
        "messages": [],
        "phase": InterviewPhase.GREETING.value,
        "target_role": (target_role or "").strip() or "候选人应聘岗位",
        "job_description": (job_description or "").strip(),
        "resume_context": resume_ctx,
        "questions_asked": [],
        "phase_question_count": 0,
        "is_finished": False,
        "last_eval": {},
        "eval_history": [],
    }

    system = await _system_prompt(state, user_id)
    opening = await get_llm(user_id).ainvoke([
        SystemMessage(content=system),
        HumanMessage(content="面试开始，请开场并让候选人做自我介绍。"),
    ])

    state["messages"].append(AIMessage(content=opening))
    save_state(session_id, state, user_id=user_id)
    return opening


def route_after_answer(state: ResumeInterviewState) -> str:
    """After user answers: keep asking, advance phase, or end."""
    if state.get("is_finished"):
        return "end"

    phase = state.get("phase", "greeting")
    count = state.get("phase_question_count", 0)
    last_eval = state.get("last_eval")

    # Hard ceiling — prevent infinite loops regardless of eval data
    if count >= HARD_MAX_PER_PHASE:
        return "advance"

    # Simple phases: count-based rules
    if phase == "greeting" and count >= 1:
        return "advance"
    if phase == "self_intro" and count >= 2:
        return "advance"
    if phase == "reverse_qa" and count >= 2:
        return "end"

    # Technical / project_deep_dive / behavioral: eval-driven with count fallback
    if phase in SCORED_PHASES:
        score = (last_eval or {}).get("score")
        weak = isinstance(score, (int, float)) and score < 5

        # Need at least 2 questions before considering advancement.
        # Never bail out right after a weak answer — dig one more round on the
        # same point first; the count fallback below still caps the phase length.
        if count >= 2 and last_eval and last_eval.get("should_advance") and not weak:
            logger.info(f"Eval-driven advance: {phase} after {count} questions")
            return "advance"

        # Count-based fallback
        max_q = settings.max_questions_per_phase
        if count >= max_q:
            return "advance"

    return "ask"


def _advance_phase(state: ResumeInterviewState) -> None:
    """Move to the next interview phase; mark finished when already at the last one."""
    try:
        idx = PHASE_ORDER.index(state.get("phase", "greeting"))
    except ValueError:
        state["is_finished"] = True
        return
    if idx >= len(PHASE_ORDER) - 1:
        state["is_finished"] = True
        return
    state["phase"] = PHASE_ORDER[idx + 1]
    state["phase_question_count"] = 0
    state["last_eval"] = {}


def _apply_answer(state: ResumeInterviewState, user_message: str) -> bool:
    """记录用户回答并路由。返回是否还需要生成下一问(False = 面试结束)。"""
    state["messages"].append(HumanMessage(content=user_message))
    decision = route_after_answer(state)
    if decision == "end":
        state["is_finished"] = True
        return False
    if decision == "advance":
        _advance_phase(state)
        if state.get("is_finished"):
            return False
    return True


def _absorb_reply(state: ResumeInterviewState, raw: str) -> str:
    """吸收面试官原始输出:剥离内联 EVAL、更新问题记录与计数,返回干净文本。"""
    clean, eval_data = _parse_inline_eval(raw)
    count = state.get("phase_question_count", 0)

    state["messages"].append(AIMessage(content=clean))
    state["questions_asked"] = state.get("questions_asked", []) + [clean[:100]]
    state["phase_question_count"] = count + 1

    if eval_data:
        eval_data["phase"] = state.get("phase", "")
        eval_data["question_index"] = count
        state["last_eval"] = eval_data
        state["eval_history"] = list(state.get("eval_history", [])) + [eval_data]
        logger.info(
            f"Inline eval: phase={eval_data['phase']}, "
            f"score={eval_data.get('score')}, "
            f"should_advance={eval_data.get('should_advance')}"
        )
    return clean


async def take_turn(
    session_id: str, user_id: str, state: ResumeInterviewState, user_message: str,
) -> tuple[str, bool]:
    """处理一轮回答。返回 (面试官回复, is_finished);面试结束时回复为空串。"""
    if not _apply_answer(state, user_message):
        save_state(session_id, state, user_id=user_id)
        return "", True

    system = await _system_prompt(state, user_id)
    raw = await get_llm(user_id).ainvoke(
        [SystemMessage(content=system)] + list(state["messages"])
    )
    clean = _absorb_reply(state, raw)
    save_state(session_id, state, user_id=user_id)
    return clean, bool(state.get("is_finished"))


async def stream_turn(
    session_id: str, user_id: str, state: ResumeInterviewState, user_message: str,
) -> AsyncIterator[str]:
    """处理一轮回答(流式)。逐段产出面试官原始输出(含内联 EVAL 标签,由调用方
    过滤展示);流结束后解析 EVAL 并整体落盘。面试结束时不产出任何内容。"""
    if not _apply_answer(state, user_message):
        save_state(session_id, state, user_id=user_id)
        return

    system = await _system_prompt(state, user_id)
    chunks: list[str] = []
    async for token in get_llm(user_id).astream(
        [SystemMessage(content=system)] + list(state["messages"])
    ):
        chunks.append(token)
        yield token

    _absorb_reply(state, "".join(chunks))
    save_state(session_id, state, user_id=user_id)
