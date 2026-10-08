from fastapi import APIRouter

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o Redis: isso é papel do /ready."""
    return {"status": "ok"}


# TODO(#41): GET /ready, com PING no Redis e a conexão com o RabbitMQ aberta.
# Responde 503 quando um dos dois não responde. Os clientes chegam por Depends.
