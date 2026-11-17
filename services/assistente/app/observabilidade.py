"""Logs JSON e rastreabilidade HTTP, no mesmo formato de Animais."""

import logging
import socket
import time
import uuid

from fastapi import FastAPI, Request
from pythonjsonlogger.json import JsonFormatter

logger = logging.getLogger(__name__)


def configurar_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"levelname": "nivel", "asctime": "timestamp", "message": "mensagem"},
        )
    )
    logging.getLogger().handlers = [handler]
    logging.getLogger().setLevel(logging.INFO)


def instalar_rastreabilidade(app: FastAPI) -> None:
    servido_por = socket.gethostname()

    @app.middleware("http")
    async def rastrear(request: Request, call_next):
        inicio = time.perf_counter()
        correlation_id = request.headers.get("X-Correlation-Id") or str(uuid.uuid4())
        request.state.correlation_id = correlation_id
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = correlation_id
        response.headers["X-Served-By"] = servido_por
        logger.info(
            "requisição",
            extra={
                "correlationId": correlation_id,
                "metodo": request.method,
                "caminho": request.url.path,
                "status": response.status_code,
                "duracaoMs": round((time.perf_counter() - inicio) * 1000, 2),
            },
        )
        return response
