"""Ponto de entrada do serviço Assistente: `uvicorn app.main:app --port 8003`."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Único lugar que abre conexões.
    # TODO(#42): abrir o Qdrant (AsyncQdrantClient), o Redis (redis.asyncio) e um
    # httpx.AsyncClient para o Animais, e guardar os três em app.state.
    # O cliente do LLM não é criado aqui: com LLM_API_KEY vazia o serviço sobe em modo
    # degradado, e alguns clientes recusam chave vazia já no construtor (#69).
    yield
    # Feche aqui, na ordem inversa da abertura.


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Assistente", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    # TODO(#42): middleware de X-Correlation-Id e X-Served-By, e logs JSON.
    return app


app = create_app()
