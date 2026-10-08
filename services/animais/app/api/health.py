from fastapi import APIRouter

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o banco: isso é papel do /ready."""
    return {"status": "ok"}


# TODO(#39): GET /ready, com `ping` no MongoDB e 503 quando ele não responde.
