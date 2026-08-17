"""Per-user LLM and embedding providers.

Whose config to load resolves as: explicit user_id arg → current-user ContextVar.
That user's provider.json wins; when they haven't configured one, resolution falls
back to the optional platform_* settings (empty by default, in which case the user
must bring their own key). Every resolved config carries a "source" field —
"user" or "platform" — which is what decides whether a call counts against the
platform's quota. See backend.usage.

LLM clients are cheap to construct, so they are built per call. Embedding
backends (esp. local HuggingFace models) are expensive, so they are cached per
(user, config-signature) and rebuilt only when the signature changes.
"""

import logging
from collections.abc import AsyncIterator

from openai import AsyncOpenAI, OpenAI

from backend.config import (
    DEFAULT_API_EMBED_BATCH_SIZE,
    embedding_api_model_of,
    embedding_local_model_of,
    embedding_local_path_of,
    embedding_mode_of,
    embedding_target_of,
    normalize_embedding_api_base,
    settings,
)
from backend.storage.user_settings import load_user_provider, load_user_services
from backend.usage import PLATFORM, USER, check_quota, record_call
from backend.user_context import get_current_user_id

# user_key ("__global__" or user_id) → (signature, embed_instance)
_embedding_cache: dict[str, tuple[str, object]] = {}

logger = logging.getLogger("uvicorn")

_DEFAULT_TEMPERATURE = 0.7
_COPILOT_TEMPERATURE = 0.3  # Copilot 场景偏确定性


class ProviderNotConfigured(Exception):
    """A user tried to use an LLM/Embedding that neither they nor the platform has
    configured. Mapped to a 400 with a 'go configure' hint in app.py so the UI can
    route them to onboarding.

    Deliberately NOT a RuntimeError: this is a control signal, not a failure, and
    routers wrap LLM calls in `except RuntimeError -> 500`. Inheriting from it sent
    users a raw 500 instead of the onboarding redirect.
    """

    def __init__(self, what: str):
        self.what = what  # "LLM" | "Embedding"
        super().__init__(f"{what} provider not configured for this user")


def _effective_uid(user_id: str | None) -> str | None:
    return user_id if user_id is not None else get_current_user_id()


# ── Config resolution ──

def _platform_llm_config() -> dict | None:
    """平台兜底 LLM;未配置返回 None。"""
    if not (settings.platform_llm_api_key and settings.platform_llm_model):
        return None
    return {
        "api_base": settings.platform_llm_api_base,
        "api_key": settings.platform_llm_api_key,
        "model": settings.platform_llm_model,
        "temperature": _DEFAULT_TEMPERATURE,
        "source": PLATFORM,
    }


def _platform_embedding_config() -> dict | None:
    """平台兜底 Embedding;未配置返回 None。平台只提供 API 模式——本地模型是
    部署方自己的机器资源,没有"代付"一说。"""
    if not (settings.platform_embedding_api_key and settings.platform_embedding_model):
        return None
    return {
        "backend": "api",
        "api_base": settings.platform_embedding_api_base,
        "api_key": settings.platform_embedding_api_key,
        "api_model": settings.platform_embedding_model,
        "local_model": "", "local_path": "",
        "api_batch_size": DEFAULT_API_EMBED_BATCH_SIZE,
        "source": PLATFORM,
    }


def resolve_llm_config(user_id: str | None = None) -> dict:
    """Resolve this user's LLM config: their own key if configured, else the
    platform fallback, else empty (surfacing as ProviderNotConfigured at build)."""
    uid = _effective_uid(user_id)
    override = load_user_provider(uid)[0] if uid else None
    if override is not None and override.api_key and override.model:
        return {
            "api_base": override.api_base,
            "api_key": override.api_key,
            "model": override.model,
            "temperature": override.temperature,
            "source": USER,
        }
    platform = _platform_llm_config()
    if platform is not None:
        return platform
    return {
        "api_base": "", "api_key": "", "model": "",
        "temperature": _DEFAULT_TEMPERATURE, "source": USER,
    }


def resolve_embedding_config(user_id: str | None = None) -> dict:
    """Resolve this user's embedding config: their own if configured, else the
    platform fallback, else empty."""
    uid = _effective_uid(user_id)
    override = load_user_provider(uid)[1] if uid else None
    # backend == "local" 也算已配置:用内置默认模型时 local_model/local_path 都为空,
    # 漏掉它会把这类用户误判为未配置而推去平台 API,凭空触发一次索引重建。
    configured = override is not None and (
        override.api_key or override.local_model or override.local_path
        or override.backend == "local"
    )
    if configured:
        return {
            "backend": override.backend,
            "api_base": override.api_base,
            "api_key": override.api_key,
            "api_model": override.api_model,
            "local_model": override.local_model,
            "local_path": override.local_path,
            "api_batch_size": override.api_batch_size,
            "source": USER,
        }
    platform = _platform_embedding_config()
    if platform is not None:
        return platform
    return {
        "backend": "", "api_base": "", "api_key": "",
        "api_model": "", "local_model": "", "local_path": "",
        "api_batch_size": DEFAULT_API_EMBED_BATCH_SIZE,
        "source": USER,
    }


def embedding_signature(user_id: str | None = None) -> str:
    """Vector-compatibility identity (model/dimensions). On-disk indexes and
    memory_vectors rows are valid only for this exact value — when it changes they
    must be wiped and rebuilt. Excludes api_key/api_base, which don't affect vectors."""
    c = resolve_embedding_config(user_id)
    return embedding_target_of(
        c["backend"], c["api_base"], c["api_key"], c["api_model"],
        c["local_model"], c["local_path"], settings.base_dir, "",
    )


def _embedding_cache_sig(c: dict) -> str:
    """Full-config cache key — any field change (incl. api_key/api_base) must
    rebuild the embedding client, even when the model identity is unchanged."""
    return "|".join(
        (c["backend"], c["api_base"], c["api_key"], c["api_model"],
         c["local_model"], c["local_path"], str(c["api_batch_size"]))
    )


# ── 消息构造 ──
# 统一 OpenAI 消息格式(纯 dict,可直接 JSON 序列化/入库)。构造一律经这三个
# 助手,以后换供应商或扩展字段只改这里。

def SystemMessage(content: str) -> dict:
    return {"role": "system", "content": content}


def HumanMessage(content: str) -> dict:
    return {"role": "user", "content": content}


def AIMessage(content: str) -> dict:
    return {"role": "assistant", "content": content}


# ── LLM ──

class ChatLLM:
    """OpenAI 兼容 Chat 客户端。messages 用上面的消息助手构造;
    invoke/ainvoke 返回回复文本,astream 逐段产出增量文本。"""

    def __init__(
        self, model: str, api_key: str, api_base: str, temperature: float,
        user_id: str | None = None, source: str = USER,
    ):
        self.model = model
        self.temperature = temperature
        self._api_key = api_key
        self._api_base = api_base or None
        self._user_id = user_id
        self._source = source

    def _record(self, resp=None) -> None:
        """流式响应默认不带 usage,token 数记 0——配额是按调用次数算的,不依赖它。"""
        usage = getattr(resp, "usage", None)
        record_call(
            self._user_id, self._source, self.model,
            getattr(usage, "prompt_tokens", 0) or 0,
            getattr(usage, "completion_tokens", 0) or 0,
        )

    def invoke(self, messages: list[dict]) -> str:
        check_quota(self._user_id, self._source)
        client = OpenAI(api_key=self._api_key, base_url=self._api_base)
        resp = client.chat.completions.create(
            model=self.model, messages=messages, temperature=self.temperature,
        )
        self._record(resp)
        return resp.choices[0].message.content or ""

    async def ainvoke(self, messages: list[dict]) -> str:
        check_quota(self._user_id, self._source)
        client = AsyncOpenAI(api_key=self._api_key, base_url=self._api_base)
        resp = await client.chat.completions.create(
            model=self.model, messages=messages, temperature=self.temperature,
        )
        self._record(resp)
        return resp.choices[0].message.content or ""

    async def astream(self, messages: list[dict]) -> AsyncIterator[str]:
        check_quota(self._user_id, self._source)
        client = AsyncOpenAI(api_key=self._api_key, base_url=self._api_base)
        stream = await client.chat.completions.create(
            model=self.model, messages=messages, temperature=self.temperature,
            stream=True,
        )
        try:
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        finally:
            # finally 而非循环后:消费方中途放弃时 token 已经烧掉了,照记不误。
            self._record()


def _require_llm(c: dict):
    if not c["api_key"] or not c["model"]:
        raise ProviderNotConfigured("LLM")


def get_llm(user_id: str | None = None) -> ChatLLM:
    """当前用户的主 LLM。"""
    c = resolve_llm_config(user_id)
    _require_llm(c)
    return ChatLLM(
        c["model"], c["api_key"], c["api_base"], c["temperature"],
        user_id=_effective_uid(user_id), source=c["source"],
    )


def get_copilot_llm(user_id: str | None = None) -> ChatLLM:
    """Copilot uses the user's own main LLM (no separate Copilot provider)."""
    c = resolve_llm_config(user_id)
    _require_llm(c)
    return ChatLLM(
        c["model"], c["api_key"], c["api_base"], _COPILOT_TEMPERATURE,
        user_id=_effective_uid(user_id), source=c["source"],
    )


# ── Embedding ──

class _APIEmbedding:
    """OpenAI-compatible embedding client. Exposes the minimal interface the rest of
    the codebase relies on (get_text_embedding / get_text_embedding_batch). Batches to
    `batch_size` to respect per-request limits, which vary by provider.

    Some otherwise OpenAI-compatible providers (notably ModelScope API-Inference)
    accept only a scalar string for ``input``. Prefer efficient array requests, but
    learn and remember a scalar-only capability after a 400 response and a successful
    scalar retry. This also safely handles providers whose effective batch limit is
    lower than the configured value.
    """

    def __init__(self, model: str, api_key: str, api_base: str, batch_size: int):
        from openai import OpenAI

        normalized_base = normalize_embedding_api_base(api_base)
        self._client = OpenAI(api_key=api_key, base_url=normalized_base or None)
        self._model = model
        self._batch = max(1, batch_size)
        self._array_input_supported: bool | None = None

    def _request(self, value: str | list[str], expected_count: int) -> list[list[float]]:
        resp = self._client.embeddings.create(model=self._model, input=value)
        data = list(resp.data)
        if data and all(isinstance(getattr(item, "index", None), int) for item in data):
            data.sort(key=lambda item: item.index)
        vectors = [item.embedding for item in data]
        if len(vectors) != expected_count:
            raise RuntimeError(
                f"Embedding provider returned {len(vectors)} vectors for "
                f"{expected_count} inputs"
            )
        return vectors

    def get_text_embedding(self, text: str) -> list[float]:
        # A scalar input is accepted by both the OpenAI API and scalar-only compatible
        # providers, so single-text call sites do not need capability negotiation.
        return self._request(text, 1)[0]

    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self._batch):
            batch = texts[i:i + self._batch]
            if self._array_input_supported is False:
                out.extend(self._request(text, 1)[0] for text in batch)
                continue

            try:
                out.extend(self._request(batch, len(batch)))
                self._array_input_supported = True
            except Exception as exc:
                # Authentication, throttling and service failures must surface as-is.
                # Only a provider-declared bad request can indicate an unsupported
                # array shape or a stricter batch limit.
                if getattr(exc, "status_code", None) != 400:
                    raise

                first = self._request(batch[0], 1)[0]
                self._array_input_supported = False
                logger.warning(
                    "Embedding provider rejected array input; falling back to "
                    "scalar requests for model %s.",
                    self._model,
                )
                out.append(first)
                out.extend(self._request(text, 1)[0] for text in batch[1:])
        return out


class _LocalEmbedding:
    """Local sentence-transformers embedding with the same minimal interface."""

    def __init__(self, model_name_or_path: str):
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name_or_path)

    def get_text_embedding(self, text: str) -> list[float]:
        return self._model.encode(text).tolist()

    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts).tolist()

def _build_embedding(c: dict):
    deprecated = ""
    if embedding_mode_of(c["backend"], c["api_base"], c["api_key"]) == "api":
        if not c["api_key"]:
            raise ProviderNotConfigured("Embedding")
        model_name = embedding_api_model_of(c["api_model"], deprecated)
        if not model_name:
            raise RuntimeError("EMBEDDING_API_MODEL is required when EMBEDDING_BACKEND=api")
        return _APIEmbedding(
            model=model_name,
            api_key=c["api_key"],
            api_base=c["api_base"],
            batch_size=c["api_batch_size"],
        )

    try:
        import sentence_transformers  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "Local embeddings require optional dependencies. "
            "Install `pip install -r requirements.local-embedding.txt` "
            "and a torch build that matches your environment."
        ) from exc

    model_path = embedding_local_path_of(c["local_path"], c["local_model"], settings.base_dir, deprecated)
    if model_path is not None:
        return _LocalEmbedding(str(model_path))
    model_name = embedding_local_model_of(c["local_model"], deprecated)
    if model_name:
        return _LocalEmbedding(model_name)
    raise RuntimeError(
        "LOCAL_EMBEDDING_MODEL or LOCAL_EMBEDDING_PATH is required when EMBEDDING_BACKEND=local"
    )


def get_embedding(user_id: str | None = None):
    """Embedding model, cached per (user, full-config signature)."""
    c = resolve_embedding_config(user_id)
    sig = _embedding_cache_sig(c)
    key = _effective_uid(user_id) or "__global__"
    cached = _embedding_cache.get(key)
    if cached and cached[0] == sig:
        return cached[1]
    inst = _build_embedding(c)
    _embedding_cache[key] = (sig, inst)
    return inst


def reset_embedding_cache(user_id: str | None = None):
    """Drop cached embedding(s) so the next call rebuilds. None clears all users."""
    if user_id is None:
        _embedding_cache.clear()
    else:
        _embedding_cache.pop(user_id, None)


# ── Connectivity probes (test the *provided* config, not the saved one) ──

def probe_llm(api_base: str, api_key: str, model: str) -> None:
    """Verify an LLM config is reachable & valid by issuing a 1-token chat
    completion. Returns None on success; raises (openai errors / ProviderNotConfigured)
    on any failure. Drives the settings 'test connection' button and the onboarding
    gate, so it tests the form values rather than what's persisted."""
    from openai import OpenAI

    if not api_key or not model:
        raise ProviderNotConfigured("LLM")
    client = OpenAI(api_key=api_key, base_url=api_base or None, timeout=20.0, max_retries=0)
    client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=1,
        temperature=0,
    )


def probe_embedding(config: dict) -> None:
    """Verify an embedding config by embedding a probe string. `config` matches
    EmbeddingSettings (backend/api_base/api_key/api_model/local_model/local_path/...).
    Returns None on success; raises on failure. For local mode, loading the model is
    itself the test."""
    if embedding_mode_of(config["backend"], config["api_base"], config["api_key"]) == "api":
        if not config["api_key"]:
            raise ProviderNotConfigured("Embedding")
        model_name = embedding_api_model_of(config["api_model"], "")
        if not model_name:
            raise RuntimeError("Embedding Model 必填")
        from openai import OpenAI

        normalized_base = normalize_embedding_api_base(config["api_base"])
        client = OpenAI(api_key=config["api_key"], base_url=normalized_base or None,
                        timeout=20.0, max_retries=0)
        # Scalar input is the common denominator across OpenAI-compatible embedding
        # services; runtime batch calls negotiate array support independently.
        client.embeddings.create(model=model_name, input="ping")
        return
    _build_embedding(config).get_text_embedding("ping")


# ── Optional service credentials (per-user, no global fallback) ──

def resolve_dashscope_key(user_id: str | None = None) -> str:
    """DashScope key for ASR (语音输入 / 录音转写 / Copilot 实时)。未配置返回空串。"""
    uid = _effective_uid(user_id)
    return load_user_services(uid).dashscope_api_key if uid else ""


def resolve_tavily_key(user_id: str | None = None) -> str:
    """Tavily key for Copilot 联网搜索。未配置返回空串。"""
    uid = _effective_uid(user_id)
    return load_user_services(uid).tavily_api_key if uid else ""


def resolve_oss_config(user_id: str | None = None) -> dict:
    """阿里云 OSS 配置(录音复盘长音频上传)。未配置字段为空串。"""
    uid = _effective_uid(user_id)
    s = load_user_services(uid) if uid else None
    return {
        "access_key_id": s.oss_access_key_id if s else "",
        "access_key_secret": s.oss_access_key_secret if s else "",
        "bucket": s.oss_bucket if s else "",
        "endpoint": s.oss_endpoint if s else "",
    }


def provider_status(user_id: str | None = None) -> dict:
    """Whether the user has the two essentials configured. Drives the first-run
    onboarding gate (DashScope/Tavily/OSS are optional and not checked here)."""
    llm = resolve_llm_config(user_id)
    emb = resolve_embedding_config(user_id)
    if embedding_mode_of(emb["backend"], emb["api_base"], emb["api_key"]) == "api":
        emb_ok = bool(emb["api_key"])
    else:
        emb_ok = bool(emb["local_model"] or emb["local_path"])
    return {"llm": bool(llm["api_key"] and llm["model"]), "embedding": emb_ok}
