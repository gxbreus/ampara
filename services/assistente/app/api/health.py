from fastapi import APIRouter

router = APIRouter(tags=["saúde"])


@router.get("/health")
async def health() -> dict[str, str]:
    """200 enquanto o processo está de pé. Não consulta o Qdrant: isso é papel do /ready."""
    return {"status": "ok"}


# TODO(#42): GET /ready, com o Qdrant (get_collections) e o Redis (PING), e 503 quando
# um dos dois não responde. Nunca chame o provedor de LLM aqui: ele fora do ar é tratado
# com fallback (#69) e não pode tirar o serviço do ar.
