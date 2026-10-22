from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from app.dependencias import get_cliente_mongo_escrita, get_cliente_mongo_leitura


def test_health_responde_ok(cliente: TestClient):
    resposta = cliente.get("/health")

    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok"}
    assert "X-Correlation-Id" in resposta.headers
    assert "X-Served-By" in resposta.headers


def test_health_propaga_correlation_id(cliente: TestClient):
    resposta = cliente.get("/health", headers={"X-Correlation-Id": "meu-id-123"})

    assert resposta.status_code == 200
    assert resposta.headers["X-Correlation-Id"] == "meu-id-123"


def test_ready_responde_pronto_quando_bancos_respondem(cliente: TestClient):
    mock_cliente_ok = MagicMock()
    mock_cliente_ok.admin.command = AsyncMock(return_value={"ok": 1.0})

    cliente.app.dependency_overrides[get_cliente_mongo_escrita] = lambda: mock_cliente_ok
    cliente.app.dependency_overrides[get_cliente_mongo_leitura] = lambda: mock_cliente_ok

    try:
        resposta = cliente.get("/ready")
        assert resposta.status_code == 200
        assert resposta.json() == {"status": "pronto"}
    finally:
        cliente.app.dependency_overrides.clear()


def test_ready_responde_503_quando_banco_falha(cliente: TestClient):
    mock_cliente_erro = MagicMock()
    mock_cliente_erro.admin.command = AsyncMock(side_effect=ConnectionError("Mongo offline"))
    mock_cliente_ok = MagicMock()
    mock_cliente_ok.admin.command = AsyncMock(return_value={"ok": 1.0})

    cliente.app.dependency_overrides[get_cliente_mongo_escrita] = lambda: mock_cliente_erro
    cliente.app.dependency_overrides[get_cliente_mongo_leitura] = lambda: mock_cliente_ok

    try:
        resposta = cliente.get("/ready")
        assert resposta.status_code == 503
        assert resposta.json() == {
            "status": "indisponivel",
            "detalhe": "O MongoDB de Animais não respondeu.",
        }
    finally:
        cliente.app.dependency_overrides.clear()
