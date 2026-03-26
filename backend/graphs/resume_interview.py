"""模式1: 简历模拟面试 LangGraph."""
import json
import logging
import re

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from backend.models import ResumeInterviewState, InterviewPhase
from backend.config import settings
from backend.llm_provider import get_langchain_llm
from backend.indexer import query_resume
from backend.memory import get_profile_summary
from backend.prompts.interviewer import RESUME_INTERVIEWER_SYSTEM

logger = logging.getLogger("uvicorn")

PHASE_ORDER = [
    InterviewPhase.GREETING.value,
    InterviewPhase.SELF_INTRO.value,
    InterviewPhase.TECHNICAL.value,
    InterviewPhase.PROJECT_DEEP_DIVE.value,
    InterviewPhase.REVERSE_QA.value,
]

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


def _make_init_interview(user_id: str):
    """Create init_interview node bound to a specific user."""
    def init_interview(state: ResumeInterviewState) -> dict:
        """Load resume context and prepare the opening."""
        resume_ctx = query_resume("列出候选人的所有项目经历、技能和教育背景", user_id)

        system_prompt = RESUME_INTERVIEWER_SYSTEM.format(
            resume_context=resume_ctx,
            phase=InterviewPhase.GREETING.value,
            asked_questions="无",
            user_profile=get_profile_summary(user_id),
        )

        llm = get_langchain_llm()
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content="面试开始，请开场并让候选人做自我介绍。"),
        ])

        return {
            "messages": [response],
            "resume_context": resume_ctx,
            "phase": InterviewPhase.GREETING.value,
            "questions_asked": [],
            "phase_question_count": 0,
            "is_finished": False,
            "eval_history": [],
        }
    return init_interview


def _make_interviewer_ask(user_id: str):
    """Create interviewer_ask node bound to a specific user."""
    def interviewer_ask(state: ResumeInterviewState) -> dict:
        """Generate next question based on current phase and conversation."""
        asked = state.get("questions_asked", [])
        asked_str = "\n".join(f"- {q}" for q in asked) if asked else "无"

        system_prompt = RESUME_INTERVIEWER_SYSTEM.format(
            resume_context=state.get("resume_context", ""),
            phase=state.get("phase", "technical"),
            asked_questions=asked_str,
            user_profile=get_profile_summary(user_id),
        )

        llm = get_langchain_llm()
        messages = [SystemMessage(content=system_prompt)] + list(state.get("messages", []))
        response = llm.invoke(messages)

        # Parse and strip inline eval from response
        clean_content, eval_data = _parse_inline_eval(response.content)
        count = state.get("phase_question_count", 0)

        result = {
            "messages": [AIMessage(content=clean_content)],
            "questions_asked": asked + [clean_content[:100]],
            "phase_question_count": count + 1,
        }

        if eval_data:
            eval_data["phase"] = state.get("phase", "")
            eval_data["question_index"] = count
            result["last_eval"] = eval_data
            result["eval_history"] = list(state.get("eval_history", [])) + [eval_data]
            logger.info(
                f"Inline eval: phase={eval_data['phase']}, "
                f"score={eval_data.get('score')}, "
                f"should_advance={eval_data.get('should_advance')}"
            )

        return result
    return interviewer_ask


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

    # Technical / project_deep_dive: eval-driven with count fallback
    if phase in ("technical", "project_deep_dive"):
        # Need at least 2 questions before considering advancement
        if count >= 2 and last_eval and last_eval.get("should_advance"):
            logger.info(f"Eval-driven advance: {phase} after {count} questions")
            return "advance"

        # Count-based fallback
        max_q = settings.max_questions_per_phase
        if count >= max_q:
            return "advance"

    return "ask"


def advance_phase(state: ResumeInterviewState) -> dict:
    """Move to the next interview phase."""
    current_phase = state.get("phase", "greeting")

    try:
        idx = PHASE_ORDER.index(current_phase)
    except ValueError:
        return {"is_finished": True}

    if idx >= len(PHASE_ORDER) - 1:
        return {"is_finished": True}

    return {
        "phase": PHASE_ORDER[idx + 1],
        "phase_question_count": 0,
        "last_eval": {},
    }


def wait_for_answer(state: ResumeInterviewState) -> dict:
    """Graph pauses here for user input."""
    return {}


def end_interview(state: ResumeInterviewState) -> dict:
    """Mark interview as finished before reaching END."""
    return {"is_finished": True}


def compile_resume_interview(user_id: str):
    """Build and compile the resume interview graph."""
    graph = StateGraph(ResumeInterviewState)

    graph.add_node("init", _make_init_interview(user_id))
    graph.add_node("ask", _make_interviewer_ask(user_id))
    graph.add_node("advance", advance_phase)
    graph.add_node("wait", wait_for_answer)
    graph.add_node("end_node", end_interview)

    graph.add_edge(START, "init")
    graph.add_edge("init", "wait")
    graph.add_edge("ask", "wait")
    graph.add_edge("advance", "ask")
    graph.add_edge("end_node", END)

    graph.add_conditional_edges("wait", route_after_answer, {
        "ask": "ask",
        "advance": "advance",
        "end": "end_node",
    })

    return graph.compile(
        checkpointer=MemorySaver(),
        interrupt_before=["wait"],
    )
