"""Ponto de entrada do serviço Assistente: `uvicorn app.main:app --port 8003`."""

import asyncio
import logging
from contextlib import AsyncExitStack, asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from qdrant_client import AsyncQdrantClient
from redis.asyncio import Redis

from app import conhecimento
from app.api import assistente, health
from app.cache_semantico import CacheSemantico
from app.config import get_settings
from app.indice import Embeddings, Indice
from app.observabilidade import configurar_logging, instalar_rastreabilidade
from app.rag import Rag
from app.resiliencia import Cache, Resiliencia

logger = logging.getLogger(__name__)


def criar_llms(settings) -> list:
    """Modelo principal e de reserva na Groq. Sem chave: lista vazia (modo degradado)."""
    chave = settings.llm_api_key.get_secret_value()
    if not chave:
        logger.warning("LLM_API_KEY vazia: o assistente responde em modo degradado")
        return []
    modelos = list(dict.fromkeys([settings.modelo, *settings.modelos_reserva]))
    # max_retries=0: quem tenta de novo é a nossa resiliência, com backoff e circuito
    comum = {
        "api_key": chave,
        "temperature": 0.2,
        "max_retries": 0,
        "timeout": settings.timeout_llm_s,
    }
    if settings.llm_provider == "openai":
        from langchain_openai import ChatOpenAI

        base = settings.llm_base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
        return [ChatOpenAI(model=m, base_url=base, **comum) for m in modelos]
    from langchain_groq import ChatGroq

    return [ChatGroq(model=m, **comum) for m in modelos]


async def indexar(app: FastAPI, trechos) -> None:
    """Indexa a base em segundo plano, tentando de novo até o Qdrant responder."""
    for tentativa in range(30):
        try:
            novos = await app.state.rag.indice.garantir(trechos)
            app.state.indice_pronto = True
            logger.info(
                "índice pronto",
                extra={"trechosNovos": novos, "versao": app.state.rag.indice.versao},
            )
            return
        except Exception as erro:  # noqa: BLE001
            logger.warning(
                "Qdrant indisponível para indexar",
                extra={"tentativa": tentativa + 1, "erro": str(erro)},
            )
            await asyncio.sleep(min(2 * (tentativa + 1), 10))


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_logging()
    settings = get_settings()
    async with AsyncExitStack() as stack:
        qdrant = AsyncQdrantClient(url=settings.qdrant_url, timeout=5, trust_env=False)
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

        # base de conhecimento, embeddings e índice (#66)
        trechos = conhecimento.carregar(settings.kb_dir)
        embeddings = await asyncio.to_thread(Embeddings, settings.embeddings_model)
        indice = Indice(qdrant, embeddings, conhecimento.versao(settings.kb_dir))

        # LLM e resiliência (#67, #69): uma resiliência (com circuito) por modelo
        app.state.llms = criar_llms(settings)
        app.state.resiliencias = [Resiliencia(settings.timeout_llm_s) for _ in app.state.llms] or [
            Resiliencia(settings.timeout_llm_s)
        ]
        app.state.resiliencias_estado = app.state.resiliencias[0].estado
        app.state.rag = Rag(
            indice,
            app.state.llms,
            app.state.resiliencias,
            Cache(redis, settings.cache_ttl_s),
            settings,
            CacheSemantico(
                qdrant,
                embeddings.dimensao,
                settings.cache_semantico_limiar,
                settings.cache_ttl_s,
            )
            if settings.cache_semantico_limiar > 0
            else None,
        )
        app.state.indice_pronto = False
        tarefa = asyncio.create_task(indexar(app, trechos))
        stack.callback(tarefa.cancel)
        yield


def problema(status: int, titulo: str, detalhe: str) -> JSONResponse:
    return JSONResponse(
        {"type": "about:blank", "title": titulo, "status": status, "detail": detalhe},
        status_code=status,
        media_type="application/problem+json",
    )


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Assistente", version="1.0.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(assistente.router)
    instalar_rastreabilidade(app)

    @app.exception_handler(RequestValidationError)
    async def _validacao(_: Request, erro: RequestValidationError):
        primeiro = erro.errors()[0] if erro.errors() else {}
        detalhe = str(primeiro.get("msg", "Dados inválidos.")).removeprefix("Value error, ")
        return problema(422, "Dados inválidos", detalhe)

    @app.exception_handler(HTTPException)
    async def _http(_: Request, erro: HTTPException):
        titulos = {
            401: "Não autenticado",
            404: "Não encontrado",
            429: "Limite excedido",
            503: "Serviço indisponível",
        }
        return problema(erro.status_code, titulos.get(erro.status_code, "Erro"), str(erro.detail))

    return app


app = create_app()
