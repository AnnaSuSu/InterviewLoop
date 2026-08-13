"""Knowledge and graph routes."""

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.config import settings
from backend.graph import build_graph
from backend.indexer import invalidate_topic, load_topics
from backend.llm_provider import HumanMessage, SystemMessage, get_llm
from backend.utils import resolve_path_within, safe_child_path

router = APIRouter(prefix="/api")


def _topic_dir(topic_data: dict, user_id: str):
    root = settings.user_knowledge_path(user_id)
    directory = str(topic_data.get("dir") or "")
    try:
        return resolve_path_within(root, directory)
    except ValueError:
        raise HTTPException(400, "Invalid topic storage path")


def _core_file(topic_dir, filename: str):
    try:
        return safe_child_path(topic_dir, filename)
    except ValueError:
        raise HTTPException(400, "Invalid knowledge filename")


@router.get("/knowledge/{topic}/core")
async def get_core_knowledge(topic: str, user_id: str = Depends(get_current_user)):
    """List core knowledge files for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    topic_dir = _topic_dir(topics[topic], user_id)
    if not topic_dir.exists():
        return []

    files = []
    for file in sorted(topic_dir.glob("*.md")):
        files.append({"filename": file.name, "content": file.read_text(encoding="utf-8")})
    return files


@router.put("/knowledge/{topic}/core/{filename}")
async def update_core_knowledge(
    topic: str,
    filename: str,
    body: dict,
    user_id: str = Depends(get_current_user),
):
    """Update a core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    filepath = _core_file(_topic_dir(topics[topic], user_id), filename)
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")

    filepath.write_text(body.get("content", ""), encoding="utf-8")
    invalidate_topic(topic, user_id)
    return {"ok": True}


@router.delete("/knowledge/{topic}/core/{filename}")
async def delete_core_knowledge(
    topic: str,
    filename: str,
    user_id: str = Depends(get_current_user),
):
    """Delete a core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    filepath = _core_file(_topic_dir(topics[topic], user_id), filename)
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")

    filepath.unlink()
    invalidate_topic(topic, user_id)
    return {"ok": True}


@router.post("/knowledge/{topic}/core")
async def create_core_knowledge(topic: str, body: dict, user_id: str = Depends(get_current_user)):
    """Create a new core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    filename = body.get("filename", "").strip()
    if not filename or not filename.endswith(".md"):
        raise HTTPException(400, "Filename must end with .md")

    topic_dir = _topic_dir(topics[topic], user_id)
    topic_dir.mkdir(parents=True, exist_ok=True)
    filepath = _core_file(topic_dir, filename)
    if filepath.exists():
        raise HTTPException(409, f"File already exists: {filename}")

    filepath.write_text(body.get("content", ""), encoding="utf-8")
    invalidate_topic(topic, user_id)
    return {"ok": True, "filename": filename}


@router.post("/knowledge/{topic}/generate")
async def generate_core_knowledge(topic: str, user_id: str = Depends(get_current_user)):
    """Use LLM to generate foundational knowledge content for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    topic_name = topics[topic].get("name", topic)
    llm = get_llm(user_id)
    response = llm.invoke([
        SystemMessage(content="你是一位资深技术面试官，擅长梳理技术领域的核心知识体系。"),
        HumanMessage(content=(
            f"请为「{topic_name}」这个技术领域生成一份核心知识梳理，作为面试出题和评分的参考依据。\n\n"
            "要求：\n"
            "- 用 Markdown 格式\n"
            f"- 以 `# {topic_name}` 作为标题\n"
            "- 列出该领域最核心的 8-12 个知识点，每个用二级标题\n"
            "- 每个知识点下用简洁的要点说明关键概念、原理、常见面试考点\n"
            "- 重点覆盖：核心概念、工作原理、最佳实践、常见陷阱\n"
            "- 保持简洁实用，面向面试准备场景\n"
            "- 直接输出 Markdown 内容，不要包裹在代码块中"
        )),
    ])
    content = response.strip()

    topic_dir = _topic_dir(topics[topic], user_id)
    topic_dir.mkdir(parents=True, exist_ok=True)
    readme = topic_dir / "README.md"
    readme.write_text(content, encoding="utf-8")
    invalidate_topic(topic, user_id)
    return {"ok": True, "content": content}


@router.get("/knowledge/{topic}/high_freq")
async def get_high_freq(topic: str, user_id: str = Depends(get_current_user)):
    """Get high-frequency question bank for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    filepath = settings.user_high_freq_path(user_id) / f"{topic}.md"
    if not filepath.exists():
        return {"content": ""}
    return {"content": filepath.read_text(encoding="utf-8")}


@router.put("/knowledge/{topic}/high_freq")
async def update_high_freq(topic: str, body: dict, user_id: str = Depends(get_current_user)):
    """Update high-frequency question bank for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")

    hf_dir = settings.user_high_freq_path(user_id)
    hf_dir.mkdir(parents=True, exist_ok=True)
    filepath = hf_dir / f"{topic}.md"
    filepath.write_text(body.get("content", ""), encoding="utf-8")
    return {"ok": True}


@router.get("/graph/{topic}")
def get_topic_graph(topic: str, user_id: str = Depends(get_current_user)):
    """Build question relationship graph for a topic."""
    return build_graph(topic, user_id)
