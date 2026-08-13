"""复盘系统：面试结束后生成复盘报告。"""
from backend.llm_provider import HumanMessage, SystemMessage, get_llm
from backend.prompts.reviewer import REVIEW_SYSTEM
from backend.models import InterviewMode


def generate_review(
    mode: InterviewMode,
    messages: list,
    scores: list[dict] | None = None,
    weak_points: list[str] | None = None,
    topic: str | None = None,
    eval_history: list[dict] | None = None,
    resume_context: str | None = None,
    user_id: str | None = None,
) -> str:
    """Generate a structured review report from interview transcript."""

    # Build transcript from messages ({role, content} dicts)
    transcript_lines = []
    for msg in messages:
        if msg.get("role") == "user":
            transcript_lines.append(f"**候选人**: {msg.get('content', '')}")
        elif msg.get("role") == "assistant":
            transcript_lines.append(f"**面试官**: {msg.get('content', '')}")
    transcript = "\n\n".join(transcript_lines)

    # Build extra context
    extra = ""
    if mode == InterviewMode.TOPIC_DRILL:
        if scores:
            score_summary = "\n".join(
                f"- Q: {s.get('question', '?')} → {s.get('score', '?')}/10 ({s.get('assessment', '')})"
                for s in scores
            )
            extra += f"\n## 各题评分记录\n{score_summary}\n"
        if weak_points:
            extra += f"\n## 已识别的薄弱点\n{', '.join(weak_points)}\n"
        if topic:
            extra += f"\n## 训练领域: {topic}\n"

    # Resume mode: use inline eval history if available
    if mode == InterviewMode.RESUME and eval_history:
        eval_lines = []
        for e in eval_history:
            score = e.get("score", "?")
            brief = e.get("brief", "")
            phase = e.get("phase", "")
            line = f"- [{phase}] {score}/10 — {brief}"
            evidence = e.get("evidence")
            if evidence:
                line += f"（原话：{evidence}）"
            eval_lines.append(line)
        scored = [e["score"] for e in eval_history if isinstance(e.get("score"), (int, float))]
        avg = round(sum(scored) / len(scored), 1) if scored else None
        extra += f"\n## 面试过程评分记录\n" + "\n".join(eval_lines) + "\n"
        if avg:
            extra += f"\n平均分: {avg}/10\n"

    # Resume mode: feed the resume so the review can cross-check claims vs answers,
    # and ask for resume-consistency + model-answer sections on top of the base structure.
    if mode == InterviewMode.RESUME:
        if resume_context:
            extra += f"\n## 候选人简历（用于核验简历声称与面试表现是否一致）\n{resume_context}\n"
        extra += (
            "\n## 本次复盘的额外要求（简历面试）\n"
            "- 在标准复盘结构之外，额外加一段「## 简历印证」：逐条对比简历里的关键声称"
            "（技能/项目/成果）与候选人实际回答——哪些得到印证、哪些存疑（简历写了但答得浅、"
            "答不上或前后矛盾）。存疑的要点明确标出并引用对应原话，没有可核验的点就说明无明显出入。\n"
            "- 再加一段「## 更好的答法」：挑本场表现最弱的 2-3 个问题，给出更好的回答示范"
            "（每个 150 字以内，口语化、像真在面试里答），让候选人有可直接对照的范本。\n"
        )

    prompt = REVIEW_SYSTEM.format(
        mode=mode.value,
        transcript=transcript,
        extra_context=extra,
    )

    llm = get_llm(user_id)
    return llm.invoke([
        SystemMessage(content=prompt),
        HumanMessage(content="请生成复盘报告。"),
    ])
