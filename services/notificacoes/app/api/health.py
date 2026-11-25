import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.dependencias import RabbitDep, RedisDep

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o Redis: isso é papel do /ready."""
    return {"status": "ok"}


@router.get("/ready")
async def ready(redis: RedisDep, rabbit: RabbitDep):
    """Verifica conexão efetiva: RobustConnection pode estar aberta mas reconectando."""
    try:
        async with asyncio.timeout(2):
            await redis.ping()
            if rabbit.is_closed or not rabbit.connected.is_set():
                return JSONResponse({"status": "indisponivel"}, status_code=503)
    except Exception:
        return JSONResponse({"status": "indisponivel"}, status_code=503)
    return {"status": "ok"}
