"""Ponto de entrada do serviço Notificações: `uvicorn app.main:app --port 8002`."""

from contextlib import AsyncExitStack, asynccontextmanager

import aio_pika
from fastapi import FastAPI
from redis.asyncio import Redis

from app.api import health
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
        rabbit = await aio_pika.connect_robust(settings.amqp_url.get_secret_value(), timeout=5)
        stack.push_async_callback(rabbit.close)
        app.state.rabbit = rabbit
        # #60 inicia e encerra o consumidor dentro deste mesmo escopo.
        yield


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Notificações", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    instalar_rastreabilidade(app)
    return app


app = create_app()
