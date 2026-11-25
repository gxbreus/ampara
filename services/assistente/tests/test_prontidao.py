import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config import get_settings
from app.dependencias import get_qdrant, get_redis
from app.main import lifespan
from app.observabilidade import JsonFormatter


@pytest.mark.parametrize("chave", ["", "invalida"])
@pytest.mark.parametrize("falha", [None, "qdrant", "redis"])
def test_prontidao_independe_do_llm(cliente, monkeypatch, chave, falha):
    monkeypatch.setenv("LLM_API_KEY", chave)
    qdrant = SimpleNamespace(
        get_collections=AsyncMock(side_effect=OSError() if falha == "qdrant" else None)
    )
    redis = SimpleNamespace(ping=AsyncMock(side_effect=OSError() if falha == "redis" else None))
    cliente.app.dependency_overrides[get_qdrant] = lambda: qdrant
    cliente.app.dependency_overrides[get_redis] = lambda: redis
    resposta = cliente.get("/ready")
    assert resposta.status_code == (200 if falha is None else 503)
    assert cliente.get("/health").status_code == 200


def test_headers_e_logs_json(cliente, caplog):
    with caplog.at_level(logging.INFO, logger="app.observabilidade"):
        resposta = cliente.get("/health", headers={"X-Correlation-Id": "teste-42"})
    assert resposta.headers["X-Correlation-Id"] == "teste-42"
    assert resposta.headers["X-Served-By"]
    registro = next(r for r in caplog.records if r.name == "app.observabilidade")
    assert json.loads(JsonFormatter().format(registro))["correlationId"] == "teste-42"


@pytest.mark.parametrize("chave", ["", "invalida"])
async def test_lifespan_sem_provedor_e_com_limpeza(cliente, monkeypatch, chave):
    from app import main

    qdrant = SimpleNamespace(close=AsyncMock())
    redis = SimpleNamespace(aclose=AsyncMock())
    monkeypatch.setattr(main, "configurar_logging", lambda: None)
    monkeypatch.setenv("QDRANT_URL", "http://localhost:6333")
    monkeypatch.setenv("ASSISTENTE_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("LLM_API_KEY", chave)
    get_settings.cache_clear()
    monkeypatch.setattr(main, "AsyncQdrantClient", lambda **_kw: qdrant)
    monkeypatch.setattr(main.Redis, "from_url", lambda *_a, **_kw: redis)
    try:
        async with lifespan(cliente.app):
            assert cliente.app.state.qdrant is qdrant
            assert not cliente.app.state.animais.is_closed
            assert get_settings().llm_api_key.get_secret_value() == chave
        assert cliente.app.state.animais.is_closed
        qdrant.close.assert_awaited_once()
        redis.aclose.assert_awaited_once()
    finally:
        get_settings.cache_clear()
