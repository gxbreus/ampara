import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.dependencias import QdrantDep, RedisDep

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o Qdrant: isso é papel do /ready."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request, qdrant: QdrantDep, redis: RedisDep):
    """Qdrant e Redis no ar e a base já indexada. Não depende do LLM, da chave nem de Animais."""
    if not getattr(request.app.state, "indice_pronto", True):
        return JSONResponse({"status": "indexando"}, status_code=503)
    try:
        async with asyncio.timeout(2):
            await qdrant.get_collections()
            await redis.ping()
    except Exception:
        return JSONResponse({"status": "indisponivel"}, status_code=503)
    return {"status": "ok"}
