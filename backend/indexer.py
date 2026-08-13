"""Lightweight RAG over the user's knowledge bases.

Replaces LlamaIndex with: pypdf / plain-text loading, paragraph-aware chunking,
the user's embedding model, and numpy brute-force retrieval. Chunk vectors live in
the shared `memory_vectors` table, so there is one vector store and one invalidation
path. Knowledge files stay the source of truth; vectors are a rebuildable cache
(lazily built on first query, force-rebuilt from Settings → 更新向量索引).

Resume PDFs are intentionally loaded verbatim into interview prompts. A normal
single-page resume is small enough that vector retrieval adds failure modes without
meaningfully reducing prompt size. `RESUME_CHUNK` remains only to clean up vectors
created by older deployments.
"""
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np

from backend.config import settings
from backend.llm_provider import get_embedding
from backend.vector_memory import (
    _cosine_similarity,
    _deserialize,
    _embed,
    _get_conn,
    _serialize,
)

logger = logging.getLogger("uvicorn")

RESUME_CHUNK = "resume_chunk"
TOPIC_CHUNK = "topic_chunk"

CHUNK_SIZE = 1000       # chars per chunk (CJK-friendly; ~数百 token)
CHUNK_OVERLAP = 150     # char overlap carried between adjacent chunks
TOPIC_EXTS = {".md", ".txt", ".py"}

# Curated topic knowledge is usually small. Below this size we stuff the whole
# corpus into the prompt verbatim (no retrieval miss); only larger corpora fall
# back to RAG. Doubles as the cap on retrieved context.
KNOWLEDGE_CHAR_BUDGET = 8000


# ── Topics registry (topics.json) — not vector-related ──

def load_topics(user_id: str) -> dict:
    """Load topics from user's topics.json. Returns {key: {name, icon, dir}}."""
    from backend.preset_topics import ensure_preset_topics

    ensure_preset_topics(user_id)
    path = settings.user_topics_path(user_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_topics(topics: dict, user_id: str):
    """Write topics back to user's topics.json."""
    path = settings.user_topics_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(topics, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_topic_map(user_id: str) -> dict[str, str]:
    """Returns {key: dir_name}."""
    return {k: v["dir"] for k, v in load_topics(user_id).items()}


# ── Document loading ──

def _read_pdf(path: Path) -> str:
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # noqa: BLE001 - corrupt/locked PDF shouldn't crash ingest
        logger.warning("Failed to read PDF %s: %s", path, exc)
        return ""


def load_resume_text(user_id: str) -> str:
    """Return the user's complete resume text without Embedding or retrieval."""
    resume_dir = settings.user_resume_path(user_id)
    if not resume_dir.exists():
        return ""

    parts: list[str] = []
    pdfs = sorted(
        (path for path in resume_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pdf"),
        key=lambda path: path.name,
    )
    for pdf in pdfs:
        text = _read_pdf(pdf).strip()
        if text:
            parts.append(text)
    return "\n\n---\n\n".join(parts)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return ""


# ── Chunking ──

def _chunk_text(text: str) -> list[str]:
    """Paragraph-aware splitter with char overlap. Good enough for resumes and
    curated knowledge markdown at this scale — no token counting needed."""
    text = text.strip()
    if not text:
        return []

    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        if cur and len(cur) + len(p) + 2 > CHUNK_SIZE:
            chunks.append(cur)
            tail = cur[-CHUNK_OVERLAP:] if CHUNK_OVERLAP else ""
            cur = f"{tail}\n\n{p}" if tail else p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        chunks.append(cur)

    # Hard-split any oversized chunk (e.g. one giant paragraph with no blank lines).
    out: list[str] = []
    step = max(1, CHUNK_SIZE - CHUNK_OVERLAP)
    for c in chunks:
        if len(c) <= CHUNK_SIZE * 2:
            out.append(c)
        else:
            out.extend(c[i:i + CHUNK_SIZE] for i in range(0, len(c), step))
    return out


# ── Storage (shared memory_vectors table) ──

def _delete_chunks(user_id: str, chunk_type: str, topic: str | None):
    conn = _get_conn()
    if topic is None:
        conn.execute(
            "DELETE FROM memory_vectors WHERE chunk_type = ? AND user_id = ?",
            (chunk_type, user_id),
        )
    else:
        conn.execute(
            "DELETE FROM memory_vectors WHERE chunk_type = ? AND topic = ? AND user_id = ?",
            (chunk_type, topic, user_id),
        )
    conn.commit()
    conn.close()


def _store_chunks(user_id: str, chunk_type: str, topic: str | None, items: list[tuple[str, str]]) -> int:
    """Replace all chunks of (chunk_type, topic) with `items` [(text, source)]."""
    _delete_chunks(user_id, chunk_type, topic)
    if not items:
        return 0

    embed_model = get_embedding(user_id)
    vectors = embed_model.get_text_embedding_batch([text for text, _ in items])

    conn = _get_conn()
    now = datetime.now().isoformat()
    for (text, source), vec in zip(items, vectors):
        blob = _serialize(np.array(vec, dtype=np.float32))
        meta = json.dumps({"source": source})
        conn.execute(
            "INSERT INTO memory_vectors (chunk_type, content, topic, session_id, metadata, embedding, user_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (chunk_type, text, topic, None, meta, blob, user_id, now),
        )
    conn.commit()
    conn.close()
    return len(items)


# ── Ingestion (force-rebuild a source's vectors) ──

def ingest_topic(topic: str, user_id: str) -> int:
    """(Re)build knowledge-base chunk vectors for a topic."""
    topic_map = get_topic_map(user_id)
    if topic not in topic_map:
        raise ValueError(f"Unknown topic: {topic}. Available: {list(topic_map.keys())}")

    topic_dir = settings.user_knowledge_path(user_id) / topic_map[topic]
    items: list[tuple[str, str]] = []
    if topic_dir.exists():
        for path in sorted(topic_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() in TOPIC_EXTS:
                items.extend((c, path.name) for c in _chunk_text(_read_text(path)))
    n = _store_chunks(user_id, TOPIC_CHUNK, topic, items)
    logger.info("Ingested %d chunks for topic '%s' (user %s).", n, topic, user_id)
    return n


# ── Source presence (gates lazy ingest so empty corpora don't re-ingest each call) ──

def _topic_has_docs(topic: str, user_id: str) -> bool:
    topic_map = get_topic_map(user_id)
    if topic not in topic_map:
        return False
    topic_dir = settings.user_knowledge_path(user_id) / topic_map[topic]
    return topic_dir.exists() and any(
        p.is_file() and p.suffix.lower() in TOPIC_EXTS for p in topic_dir.rglob("*")
    )


# ── Retrieval (numpy brute-force cosine) ──

def _retrieve(user_id: str, chunk_type: str, topic: str | None, query: str, top_k: int) -> list[str]:
    conn = _get_conn()
    if topic is None:
        rows = conn.execute(
            "SELECT content, embedding FROM memory_vectors WHERE chunk_type = ? AND user_id = ?",
            (chunk_type, user_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT content, embedding FROM memory_vectors WHERE chunk_type = ? AND topic = ? AND user_id = ?",
            (chunk_type, topic, user_id),
        ).fetchall()
    conn.close()
    if not rows:
        return []

    query_vec = _embed(query, user_id)
    matrix = np.stack([_deserialize(r["embedding"]) for r in rows])
    sims = _cosine_similarity(query_vec, matrix)
    order = np.argsort(sims)[::-1][:top_k]
    return [rows[i]["content"] for i in order]


def retrieve_topic_context(topic: str, question: str, user_id: str, top_k: int = 5) -> list[str]:
    """Top-k raw knowledge chunks for a topic (lazily ingests on first use)."""
    chunks = _retrieve(user_id, TOPIC_CHUNK, topic, question, top_k)
    if not chunks and _topic_has_docs(topic, user_id):
        ingest_topic(topic, user_id)
        chunks = _retrieve(user_id, TOPIC_CHUNK, topic, question, top_k)
    return chunks


def load_topic_documents(topic: str, user_id: str) -> str:
    """Concatenate a topic's knowledge files verbatim — the source of truth, no chunking."""
    topic_map = get_topic_map(user_id)
    if topic not in topic_map:
        return ""
    topic_dir = settings.user_knowledge_path(user_id) / topic_map[topic]
    if not topic_dir.exists():
        return ""
    parts: list[str] = []
    for path in sorted(topic_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in TOPIC_EXTS:
            text = _read_text(path).strip()
            if text:
                parts.append(text)
    return "\n\n---\n\n".join(parts)


def get_topic_knowledge(
    topic: str,
    queries: list[str],
    user_id: str,
    *,
    top_k: int = 5,
    char_budget: int = KNOWLEDGE_CHAR_BUDGET,
) -> str:
    """Size-gated knowledge context for a topic.

    When the whole curated corpus fits in `char_budget`, return it verbatim — it is
    small and every part matters, so retrieval only risks dropping relevant content.
    Only larger corpora fall back to top-k RAG retrieval over `queries`."""
    full = load_topic_documents(topic, user_id)
    if len(full) <= char_budget:
        return full

    seen: set[str] = set()
    chunks: list[str] = []
    for q in queries:
        for c in retrieve_topic_context(topic, q, user_id, top_k=top_k):
            key = c[:100]
            if key not in seen:
                seen.add(key)
                chunks.append(c)
    return "\n\n---\n\n".join(chunks)[:char_budget]


# ── Invalidation ──

def invalidate_resume(user_id: str):
    """Drop legacy resume vectors created before resumes became direct context."""
    _delete_chunks(user_id, RESUME_CHUNK, None)


def invalidate_topic(topic: str, user_id: str):
    """Drop stored chunk vectors for a topic (called when its docs change)."""
    _delete_chunks(user_id, TOPIC_CHUNK, topic)


def invalidate_user_embeddings(user_id: str):
    """Drop everything embedded with the user's previous embedding model: the cached
    embedding client, all memory_vectors rows (weak points + topic/personal-document chunks),
    and cached question embeddings. Called when a user changes embedding config."""
    from backend.graph import clear_user_question_embeddings
    from backend.llm_provider import reset_embedding_cache
    from backend.vector_memory import clear_user_vectors

    reset_embedding_cache(user_id)
    clear_user_vectors(user_id)  # clears ALL memory_vectors, incl. resume/topic chunks
    clear_user_question_embeddings(user_id)

    # Best-effort cleanup of the legacy LlamaIndex on-disk caches (no longer used).
    legacy = settings.user_index_cache_path(user_id)
    if legacy.exists():
        shutil.rmtree(legacy, ignore_errors=True)
