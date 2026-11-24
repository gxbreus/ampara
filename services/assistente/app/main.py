"""Ponto de entrada do serviço Assistente: `uvicorn app.main:app --port 8003`."""

from contextlib import AsyncExitStack, asynccontextmanager

import httpx
from fastapi import FastAPI
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from app.api import health
from app.config import get_settings
from app.observabilidade import configurar_logging, instalar_rastreabilidade


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_logging()
    settings = get_settings()
    async with AsyncExitStack() as stack:
        qdrant = AsyncQdrantClient(url=settings.qdrant_url, timeout=2, trust_env=False)
        stack.push_async_callback(qdrant.close)
        app.state.qdrant = qdrant
        redis = Redis.from_url(
            settings.redis_url.get_secret_value(),
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        stack.push_async_callback(redis.aclose)
        app.state.redis = redis
        animais = await stack.enter_async_context(
            httpx.AsyncClient(base_url=settings.animais_url, timeout=3, trust_env=False)
        )
        app.state.animais = animais
        # O cliente do provedor só será construído sob demanda nas #67/#69.
        yield


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Assistente", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    instalar_rastreabilidade(app)
    return app


app = create_app()
