"""Ponto de entrada do serviço Notificações: `uvicorn app.main:app --port 8002`."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Único lugar que abre conexões e inicia tarefas em segundo plano.
    # TODO(#41): abrir o Redis (redis.asyncio) e o RabbitMQ (aio_pika.connect_robust)
    # e guardar os dois em app.state.
    # TODO(#60): iniciar o consumidor como tarefa (asyncio.create_task) usando a conexão
    # aberta aqui. Nunca crie cliente de Redis ou RabbitMQ no topo de um módulo: isso
    # exige variável de ambiente só para importar e quebra os testes.
    yield
    # Feche aqui, na ordem inversa: cancele o consumidor, depois o RabbitMQ e o Redis.


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Notificações", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    # TODO(#41): middleware de X-Correlation-Id e X-Served-By, e logs JSON.
    return app


app = create_app()
