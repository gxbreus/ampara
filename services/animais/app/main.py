"""Ponto de entrada do serviço Animais: `uvicorn app.main:app --port 8001`."""

from contextlib import asynccontextmanager
import logging
import socket
import time
import uuid

from fastapi import FastAPI, Request
from pythonjsonlogger.json import JsonFormatter

from app.api import health
from app.config import get_settings
from app.db import criar_cliente_mongo, criar_indices

logger = logging.getLogger(__name__)


def configurar_logging() -> None:
    """Configura logs estruturados em JSON no stdout."""
    handler = logging.StreamHandler()
    formatter = JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"levelname": "nivel", "asctime": "timestamp", "message": "mensagem"},
    )
    handler.setFormatter(formatter)
    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Único lugar que abre conexões e inicia tarefas em segundo plano.
    configurar_logging()
    settings = get_settings()

    cliente_escrita = criar_cliente_mongo(settings.mongo_url.get_secret_value())
    cliente_leitura = criar_cliente_mongo(settings.leitura_mongo_url.get_secret_value())

    app.state.cliente_mongo_escrita = cliente_escrita
    app.state.cliente_mongo_leitura = cliente_leitura
    app.state.banco_escrita = cliente_escrita.get_database()
    app.state.banco_leitura = cliente_leitura.get_database()

    await criar_indices(app.state.banco_escrita, app.state.banco_leitura)

    yield

    # Feche na ordem inversa da abertura
    await cliente_leitura.close()
    await cliente_escrita.close()


def create_app() -> FastAPI:
    # Não leia Settings aqui: os testes criam o app sem nenhuma variável de ambiente.
    app = FastAPI(title="Ampara · Animais", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router)

    servido_por = socket.gethostname()

    @app.middleware("http")
    async def rastreabilidade_middleware(request: Request, call_next):
        inicio = time.perf_counter()
        correlation_id = request.headers.get("X-Correlation-Id") or str(uuid.uuid4())

        request.state.correlation_id = correlation_id
        response = await call_next(request)

        duracao_ms = round((time.perf_counter() - inicio) * 1000, 2)
        response.headers["X-Correlation-Id"] = correlation_id
        response.headers["X-Served-By"] = servido_por

        logger.info(
            "requisição",
            extra={
                "correlationId": correlation_id,
                "metodo": request.method,
                "caminho": request.url.path,
                "status": response.status_code,
                "duracaoMs": duracao_ms,
            },
        )
        return response

    return app


app = create_app()
