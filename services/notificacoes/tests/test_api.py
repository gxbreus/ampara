from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from redis.exceptions import ConnectionError

from app.config import Settings, get_settings
from app.dependencias import get_caixa

ROTA = "/v1/notificacoes"


@pytest.fixture
def caixa(cliente, chave_publica):
    config = Settings.model_validate(
        {
            "redis_url": "redis://localhost/0",
            "amqp_url": "amqp://localhost/",
            "JWT_PUBLIC_KEY": chave_publica.decode().replace("\n", "\\n"),
        }
    )
    cliente.app.dependency_overrides[get_settings] = lambda: config
    repositorio = Mock(listar=AsyncMock(side_effect=ConnectionError()))
    cliente.app.dependency_overrides[get_caixa] = lambda: repositorio
    return repositorio


def test_rejeita_jwt_ausente_invalido_expirado_e_de_outro_emissor(cliente, caixa, token):
    usuario = uuid4()
    for headers in (
        {},
        {"Authorization": "Bearer quebrado"},
        token(usuario, exp=datetime.now(UTC) - timedelta(seconds=1)),
        token(usuario, iss="outro"),
        token(usuario, sub="sem-uuid"),
    ):
        resposta = cliente.get(ROTA, headers=headers)
        assert resposta.status_code == 401
        assert resposta.headers["WWW-Authenticate"] == "Bearer"
        assert resposta.headers["Content-Type"] == "application/problem+json"
    caixa.listar.assert_not_awaited()


def test_usa_apenas_sub_e_responde_503_quando_redis_falha(cliente, caixa, token):
    usuario = uuid4()
    resposta = cliente.get(f"{ROTA}?usuarioId={uuid4()}", headers=token(usuario))
    assert resposta.status_code == 503
    assert resposta.headers["Content-Type"] == "application/problem+json"
    caixa.listar.assert_awaited_once_with(usuario=usuario, nao_lidas=False, cursor=None, limite=20)


@pytest.mark.parametrize("query", ["limite=0", "limite=51", "naoLidas=invalido", "cursor="])
def test_parametros_invalidos_retornam_400(cliente, caixa, token, query):
    resposta = cliente.get(f"{ROTA}?{query}", headers=token(uuid4()))
    assert resposta.status_code == 400
    assert resposta.headers["Content-Type"] == "application/problem+json"
    caixa.listar.assert_not_awaited()
