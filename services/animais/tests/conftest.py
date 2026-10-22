import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings, get_settings
from app.main import create_app


@pytest.fixture
def cliente() -> TestClient:
    # Sem `with`: o lifespan não roda, então o teste não tenta conectar no banco.
    # Dependências como o banco são trocadas com app.dependency_overrides.
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        mongo_url=SecretStr("mongodb://localhost:27017/animais"),
        leitura_mongo_url=SecretStr("mongodb://localhost:27017/animais_leitura"),
        jwt_public_key="",
        rabbitmq_url=SecretStr("amqp://localhost"),
    )
    return TestClient(app)
