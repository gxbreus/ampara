"""Ponto de entrada do serviço Animais: `uvicorn app.main:app --port 8001`."""

from fastapi import FastAPI

from app.api import health


def create_app() -> FastAPI:
    app = FastAPI(title="Ampara · Animais", version="0.1.0")
    app.include_router(health.router)
    # TODO(#39): middleware de X-Correlation-Id e X-Served-By, logs JSON e o
    # lifespan que abre a conexão com o MongoDB e cria os índices.
    return app


app = create_app()
