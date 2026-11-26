from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def cliente() -> TestClient:
    # Sem `with`: o lifespan não roda, então o teste não tenta conectar no Redis nem no RabbitMQ.
    # Dependências como o Redis são trocadas com app.dependency_overrides.
    return TestClient(create_app())


@pytest.fixture(scope="session")
def chave_rsa():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def chave_publica(chave_rsa):
    return chave_rsa.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)


@pytest.fixture
def token(chave_rsa):
    def assinar(usuario, **claims):
        padrao = {
            "sub": str(usuario),
            "iss": "ampara-identidade",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        }
        return {"Authorization": "Bearer " + jwt.encode(padrao | claims, chave_rsa, "RS256")}

    return assinar


@pytest.fixture
def dados_evento():
    return {
        "messageId": str(uuid4()),
        "correlationId": "teste-notificacoes",
        "sagaId": str(uuid4()),
        "type": "adocao.aprovada",
        "version": 1,
        "occurredAt": "2026-11-17T15:00:00Z",
        "payload": {
            "solicitacaoId": str(uuid4()),
            "animalId": "65a2f1c4e8b9d3a7f0c1b2d4",
            "animalNome": "Thor",
            "adotanteId": str(uuid4()),
            "responsavelId": str(uuid4()),
        },
    }
