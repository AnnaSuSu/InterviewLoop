"""FastAPI app factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.llm_provider import ProviderNotConfigured
from backend.usage import QuotaExceeded
from backend.user_context import CurrentUserMiddleware
from backend.routers import (
    auth,
    copilot,
    data_migration,
    history,
    interview,
    knowledge,
    personal_agent,
    profile,
    recording,
    resume,
    settings,
    topics,
    voiceprint,
)
from backend.startup import preload_models


@asynccontextmanager
async def lifespan(app: FastAPI):
    preload_models()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="TechSpar", version="0.2.0", lifespan=lifespan)
    app.add_middleware(CurrentUserMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ProviderNotConfigured)
    async def _provider_not_configured(_: Request, exc: ProviderNotConfigured):
        # The frontend keys off code="provider_not_configured" to route to onboarding.
        label = "LLM" if exc.what == "LLM" else "Embedding"
        return JSONResponse(
            status_code=400,
            content={
                "detail": f"请先在「设置」里配置你自己的 {label} 服务后再使用",
                "code": "provider_not_configured",
                "provider": exc.what,
            },
        )

    @app.exception_handler(QuotaExceeded)
    async def _quota_exceeded(_: Request, exc: QuotaExceeded):
        # 402 而非 429:这不是限速,是额度用完了,前端据 code 引导到订阅/填自己 key。
        return JSONResponse(
            status_code=402,
            content={"detail": exc.detail, "code": "quota_exceeded"},
        )

    app.include_router(auth.router)
    app.include_router(resume.router)
    app.include_router(recording.router)
    app.include_router(topics.router)
    app.include_router(profile.router)
    app.include_router(settings.router)
    app.include_router(voiceprint.router)
    app.include_router(interview.router)
    app.include_router(knowledge.router)
    app.include_router(personal_agent.router)
    app.include_router(history.router)
    app.include_router(data_migration.router)
    app.include_router(copilot.rest_router)
    app.include_router(copilot.ws_router)
    return app
