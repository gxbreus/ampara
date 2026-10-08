import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def cliente() -> TestClient:
    # Sem `with`: o lifespan não roda, então o teste não tenta conectar no banco.
    # Dependências como o banco são trocadas com app.dependency_overrides.
    return TestClient(create_app())
