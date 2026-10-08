"""Ponto de entrada do serviço Animais: `uvicorn app.main:app --port 8001`."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Único lugar que abre conexões e inicia tarefas em segundo plano.
    # TODO(#39): abrir o MongoDB (escrita e leitura), criar os índices e guardar os
    # clientes em app.state. Nunca crie cliente de banco, Redis ou RabbitMQ no topo
    # de um módulo: isso exige variável de ambiente só para importar e quebra os testes.
    yield
    # Feche aqui, na ordem inversa da abertura (cancele as tarefas antes das conexões).


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Animais", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)
    # TODO(#39): middleware de X-Correlation-Id e X-Served-By, e logs JSON.
    return app


app = create_app()
