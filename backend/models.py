"""Data models — 会话状态 (TypedDict) + API models (Pydantic)."""
from __future__ import annotations

from enum import Enum
from typing import Literal, TypedDict
from pydantic import BaseModel, Field

from backend.config import DEFAULT_API_EMBED_BATCH_SIZE


# ── Enums ──

class InterviewMode(str, Enum):
    RESUME = "resume"
    TOPIC_DRILL = "topic_drill"
    JD_PREP = "jd_prep"
    RECORDING = "recording"


class InterviewPhase(str, Enum):
    GREETING = "greeting"
    SELF_INTRO = "self_intro"
    TECHNICAL = "technical"
    PROJECT_DEEP_DIVE = "project_deep_dive"
    BEHAVIORAL = "behavioral"
    REVERSE_QA = "reverse_qa"
    END = "end"


# ── 会话状态 (TypedDict, JSON 可序列化直接落盘) ──

class ResumeInterviewState(TypedDict, total=False):
    messages: list[dict]  # OpenAI 格式 {role, content},仅 user/assistant
    phase: str           # InterviewPhase value
    target_role: str     # 候选人应聘岗位，注入 interviewer prompt
    job_description: str # 本次目标岗位 JD，注入 interviewer prompt
    resume_context: str
    questions_asked: list[str]
    phase_question_count: int
    is_finished: bool
    last_eval: dict          # Latest inline eval from interviewer {score, should_advance, brief}
    eval_history: list       # All evals accumulated across the interview


class TopicDrillState(TypedDict, total=False):
    messages: list[dict]
    topic: str
    topic_name: str
    knowledge_context: str
    difficulty: int
    questions_asked: list[str]
    scores: list[dict]
    weak_points: list[str]
    total_questions: int
    is_finished: bool


# ── API Models (Pydantic) ──

class StartInterviewRequest(BaseModel):
    mode: InterviewMode
    topic: str | None = None
    num_questions: int | None = None
    divergence: int | None = None
    target_role: str | None = None  # resume 模式必填，缺省时回落到 profile.target_role
    job_description: str | None = Field(default=None, max_length=12000)


class JobPrepPreviewRequest(BaseModel):
    jd_text: str
    company: str | None = None
    position: str | None = None
    use_resume: bool = True


class JobPrepStartRequest(JobPrepPreviewRequest):
    preview_data: dict | None = None


class ChatRequest(BaseModel):
    session_id: str
    message: str


class PersonalAgentChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=12000)


class EndDrillRequest(BaseModel):
    answers: list[dict] = Field(default_factory=list)  # [{question_id: int, answer: str}]


class RecordingAnalyzeRequest(BaseModel):
    transcript: str = Field(min_length=1)
    recording_mode: Literal["dual", "solo"] = "dual"
    company: str | None = Field(default=None, max_length=200)
    position: str | None = Field(default=None, max_length=200)


# ── Auth Models ──

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


# ── Copilot Models ──

class StrategyNode(TypedDict, total=False):
    id: str                     # "tech_01_python_gc"
    topic: str                  # 考察维度
    sample_questions: list[str] # 典型问题
    intent: str                 # "technical" | "behavioral" | "project" | "pressure"
    depth: int                  # 追问深度 0=入口, 1=追问, 2=深追
    risk_level: str             # "safe" | "caution" | "danger"
    children: list[str]         # 子节点 ID
    trigger_condition: str      # 触发追问的回答特征
    recommended_points: list[str]  # 建议回答要点


class StrategyTree(TypedDict, total=False):
    root_nodes: list[str]
    nodes: dict[str, StrategyNode]
    phase_order: list[str]


class CopilotPrepState(TypedDict, total=False):
    user_id: str
    jd_text: str
    resume_context: str
    profile: dict

    # Layer 0: 并行 Analyst 产出
    company_report: str
    jd_analysis: dict
    fit_report: dict

    # Layer 1: HR Strategy Simulator
    question_strategy_tree: StrategyTree

    # Layer 2: Risk Assessor
    risk_map: list[dict]
    prep_hints: list[dict]

    # Prep 状态追踪
    status: str              # "running" | "done" | "error"
    progress: str            # 当前进度描述
    error: str


class CopilotPrepRequest(BaseModel):
    jd_text: str
    company: str | None = None
    position: str | None = None


# ── Settings Models ──

class UserSettings(BaseModel):
    """Per-user training preferences."""
    num_questions: int = Field(default=10, ge=5, le=20)
    divergence: int = Field(default=3, ge=1, le=5)


class LLMSettings(BaseModel):
    """Per-user LLM provider configuration."""
    api_base: str = ""
    api_key: str = ""
    model: str = ""
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class EmbeddingSettings(BaseModel):
    """Per-user embedding provider configuration."""
    backend: str = ""  # api | local | "" (auto-infer from api_base/api_key)
    api_base: str = ""
    api_key: str = ""
    api_model: str = ""
    local_model: str = ""
    local_path: str = ""
    # API 单批文本数上限,因服务商而异(如 DashScope 10、OpenAI 上千)。默认保守取小值;仅 API 模式生效。
    api_batch_size: int = Field(default=DEFAULT_API_EMBED_BATCH_SIZE, ge=1, le=2048)


class ServiceSettings(BaseModel):
    """Per-user optional service credentials. Each gates one feature; empty = that
    feature stays off for this user (no global fallback)."""
    dashscope_api_key: str = ""   # 语音输入 / 录音转写 / Copilot 实时 ASR
    tavily_api_key: str = ""      # Copilot 联网搜索
    oss_access_key_id: str = ""   # 录音复盘长音频上传（阿里云 OSS）
    oss_access_key_secret: str = ""
    oss_bucket: str = ""
    oss_endpoint: str = ""


class SystemSettings(BaseModel):
    """Global system flags."""
    allow_registration: bool = False


class SettingsResponse(BaseModel):
    """Combined response for GET/PUT /settings."""
    llm: LLMSettings
    embedding: EmbeddingSettings = Field(default_factory=EmbeddingSettings)
    services: ServiceSettings = Field(default_factory=ServiceSettings)
    system: SystemSettings = Field(default_factory=SystemSettings)
    training: UserSettings
    is_admin: bool = False  # GET-only; ignored on PUT
    configured: dict[str, bool] = Field(default_factory=dict)  # GET-only: {llm, embedding}
    last_reindex_at: str = ""  # GET-only: 上次向量索引重建时间(ISO),未重建过为空


class VoiceprintCredentials(BaseModel):
    """腾讯云 VPR 凭据（per-user）。"""
    secret_id: str
    secret_key: str
    app_id: str = ""
