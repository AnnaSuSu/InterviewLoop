from pathlib import Path
from pydantic_settings import BaseSettings


DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3"
# API embedding 单批文本数上限的默认值。各服务商上限不同(如 DashScope 10、OpenAI 可达 2048),
# 取较保守的 10 作默认,任何服务商都不会超限报 400;用户可在设置里按自己的服务商调大。
DEFAULT_API_EMBED_BATCH_SIZE = 10


# ── Embedding inference (single source of truth) ──
# Free functions so both the global Settings object and per-user resolved
# configs compute backend/model/path identically.

def normalize_embedding_api_base(api_base: str) -> str:
    """Accept an API base or a copied full ``/embeddings`` endpoint.

    OpenAI-compatible clients append ``/embeddings`` themselves. Provider docs
    commonly show the complete request URL, so treating that URL as the base
    would otherwise produce ``.../embeddings/embeddings``.
    """
    value = api_base.strip().rstrip("/")
    suffix = "/embeddings"
    if value.lower().endswith(suffix):
        base = value[:-len(suffix)].rstrip("/")
        if base:
            return base
    return value


def embedding_mode_of(backend: str, api_base: str, api_key: str) -> str:
    if backend:
        b = backend.strip().lower()
        if b in {"api", "local"}:
            return b
        raise ValueError("EMBEDDING_BACKEND must be 'api' or 'local'")
    if api_base or api_key:
        return "api"
    return "local"


def embedding_api_model_of(api_model: str, deprecated_model: str = "") -> str:
    return api_model or deprecated_model or DEFAULT_EMBEDDING_MODEL


def embedding_local_model_of(local_model: str, deprecated_model: str = "") -> str:
    return local_model or deprecated_model or DEFAULT_EMBEDDING_MODEL


def embedding_local_path_of(
    local_path: str, local_model: str, base_dir: Path, deprecated_model: str = ""
) -> "Path | None":
    if local_path:
        return Path(local_path).expanduser()
    bundled_path = base_dir / "data" / "models" / "bge-m3"
    if embedding_local_model_of(local_model, deprecated_model) == DEFAULT_EMBEDDING_MODEL and bundled_path.exists():
        return bundled_path
    return None


def embedding_target_of(
    backend: str, api_base: str, api_key: str, api_model: str,
    local_model: str, local_path: str, base_dir: Path, deprecated_model: str = "",
) -> str:
    """Identity string for an embedding config — also used as the cache/rebuild signature."""
    if embedding_mode_of(backend, api_base, api_key) == "api":
        return embedding_api_model_of(api_model, deprecated_model)
    path = embedding_local_path_of(local_path, local_model, base_dir, deprecated_model)
    if path is not None:
        return str(path)
    return embedding_local_model_of(local_model, deprecated_model)


class Settings(BaseSettings):
    # Per-user by default: LLM, Embedding, DashScope, Tavily and OSS keys all live
    # in data/users/<id>/provider.json + voiceprint.json, resolved at request time
    # by backend.llm_provider. The only secrets that may appear here are the
    # optional platform_* fallback below — see the note on that block.

    # Paths
    base_dir: Path = Path(__file__).resolve().parent.parent
    resume_path: Path = Path(__file__).resolve().parent.parent / "data" / "resume"
    knowledge_path: Path = Path(__file__).resolve().parent.parent / "data" / "knowledge"
    high_freq_path: Path = Path(__file__).resolve().parent.parent / "data" / "high_freq"
    db_path: Path = Path(__file__).resolve().parent.parent / "data" / "interviews.db"

    # Auth
    jwt_secret: str = "change-me-in-production"
    default_email: str = "admin@techspar.local"
    default_password: str = "admin123"
    default_name: str = "Admin"
    allow_registration: bool = False

    # Interview settings
    max_questions_per_phase: int = 5
    max_drill_questions: int = 15

    # ── 平台兜底模型(可选) ──
    # 留空 = 保持原样,每个用户必须自带 key。填上之后,没配 key 的用户自动回退到
    # 这里,部署方替他们承担成本——托管服务和机构统一配一把 key 的场景都靠它。
    # 已配置自己 key 的用户不受影响,依旧走自己的。
    platform_llm_api_base: str = ""
    platform_llm_api_key: str = ""
    platform_llm_model: str = ""
    platform_embedding_api_base: str = ""
    platform_embedding_api_key: str = ""
    platform_embedding_model: str = ""
    # 平台 key 的每用户每日调用上限,0 = 不限。防刷闸门,自带 key 的用户不受限。
    platform_daily_call_limit: int = 0

    def user_data_dir(self, user_id: str) -> Path:
        return self.base_dir / "data" / "users" / user_id

    def user_profile_dir(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "profile"

    def user_resume_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "resume"

    def user_knowledge_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "knowledge"

    def user_high_freq_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "high_freq"

    def user_library_path(self, user_id: str) -> Path:
        """Original files uploaded to the user's personal Agent library."""
        return self.user_data_dir(user_id) / "library"

    def user_topics_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "topics.json"

    def user_index_cache_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / ".index_cache"

    def user_index_meta_path(self, user_id: str) -> Path:
        """向量索引元数据(如上次重建时间)。独立于 .index_cache,后者重建时会被整目录清空。"""
        return self.user_data_dir(user_id) / "index_meta.json"

    def user_settings_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "settings.json"

    def system_settings_path(self) -> Path:
        """Persisted admin-controlled flags that override bootstrap .env values."""
        return self.base_dir / "data" / "system_settings.json"

    def user_provider_path(self, user_id: str) -> Path:
        """Per-user LLM/Embedding provider overrides."""
        return self.user_data_dir(user_id) / "provider.json"

    # extra="ignore": pre-existing .env files still list the old provider keys
    # (now per-user). Silently ignore them instead of failing to boot.
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
