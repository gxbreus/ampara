import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.dependencias import QdrantDep, RedisDep

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o Qdrant: isso é papel do /ready."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(qdrant: QdrantDep, redis: RedisDep):
    """A prontidão não depende do LLM, da sua chave ou de Animais."""
    try:
        async with asyncio.timeout(2):
            await qdrant.get_collections()
            await redis.ping()
    except Exception:
        return JSONResponse({"status": "indisponivel"}, status_code=503)
    return {"status": "ok"}
