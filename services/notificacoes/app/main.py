"""Ponto de entrada do serviço Notificações: `uvicorn app.main:app --port 8002`."""

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager, suppress

import aio_pika
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app import consumidor
from app.api import health, notificacoes
from app.caixa import Caixa
from app.config import get_settings
from app.observabilidade import configurar_logging, instalar_rastreabilidade


@asynccontextmanager
async def lifespan(app: FastAPI):
    configurar_logging()
    settings = get_settings()
    async with AsyncExitStack() as stack:
        redis = Redis.from_url(
            settings.redis_url.get_secret_value(),
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        stack.push_async_callback(redis.aclose)
        app.state.redis = redis
        caixa = Caixa(redis)
        app.state.caixa = caixa
        rabbit = await aio_pika.connect_robust(settings.amqp_url.get_secret_value(), timeout=5)
        stack.push_async_callback(rabbit.close)
        app.state.rabbit = rabbit
        canal = await stack.enter_async_context(rabbit.channel())
        await consumidor.iniciar(canal, caixa)
        dlq = asyncio.create_task(consumidor.alertar_dlq(rabbit))
        try:
            yield
        finally:
            dlq.cancel()
            with suppress(asyncio.CancelledError):
                await dlq


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Notificações", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    app.include_router(notificacoes.router)
    app.add_exception_handler(HTTPException, notificacoes.erro_http)
    app.add_exception_handler(RequestValidationError, notificacoes.erro_validacao)
    app.add_exception_handler(RedisError, notificacoes.erro_redis)
    instalar_rastreabilidade(app)
    return app


app = create_app()
