import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from pymongo import AsyncMongoClient

from app.db import verificar_mongo
from app.dependencias import get_cliente_mongo_escrita, get_cliente_mongo_leitura

router = APIRouter(tags=["saúde"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o banco: isso é papel do /ready."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(
    response: Response,
    cliente_escrita: Annotated[AsyncMongoClient, Depends(get_cliente_mongo_escrita)],
    cliente_leitura: Annotated[AsyncMongoClient, Depends(get_cliente_mongo_leitura)],
) -> dict[str, str]:
    """200 quando os bancos de escrita e leitura respondem; 503 quando algum deles cai."""
    escrita_ok = await verificar_mongo(cliente_escrita)
    leitura_ok = await verificar_mongo(cliente_leitura)

    if not (escrita_ok and leitura_ok):
        logger.warning(
            "MongoDB de Animais indisponível no /ready",
            extra={"escrita_ok": escrita_ok, "leitura_ok": leitura_ok},
        )
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "indisponivel", "detalhe": "O MongoDB de Animais não respondeu."}

    return {"status": "pronto"}
