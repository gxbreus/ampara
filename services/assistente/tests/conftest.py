import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def cliente() -> TestClient:
    # Sem `with`: o lifespan não roda, então o teste não conecta no Qdrant nem no Redis.
    # O LLM, a busca no Qdrant e o cliente do Animais são trocados com
    # app.dependency_overrides. Nenhum teste chama o provedor de verdade.
    return TestClient(create_app())
