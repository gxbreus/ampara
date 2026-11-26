import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from app.dependencias import get_rabbit, get_redis
from app.main import lifespan
from app.observabilidade import JsonFormatter


@pytest.mark.parametrize("falha", [None, "redis", "rabbit", "reconectando"])
def test_prontidao_e_liveness_independentes(cliente, falha):
    conectado = asyncio.Event()
    if falha != "reconectando":
        conectado.set()
    redis = SimpleNamespace(ping=AsyncMock(side_effect=OSError() if falha == "redis" else None))
    rabbit = SimpleNamespace(is_closed=falha == "rabbit", connected=conectado)
    cliente.app.dependency_overrides[get_redis] = lambda: redis
    cliente.app.dependency_overrides[get_rabbit] = lambda: rabbit
    resposta = cliente.get("/ready")
    assert resposta.status_code == (200 if falha is None else 503)
    assert cliente.get("/health").status_code == 200


def test_headers_e_log_sem_texto_ou_credenciais(cliente, caplog):
    with caplog.at_level(logging.INFO, logger="app.observabilidade"):
        resposta = cliente.get("/health", headers={"X-Correlation-Id": "teste-41"})
    assert resposta.headers["X-Correlation-Id"] == "teste-41"
    assert resposta.headers["X-Served-By"]
    registro = next(r for r in caplog.records if r.name == "app.observabilidade")
    log = json.loads(JsonFormatter().format(registro))
    assert log["correlationId"] == "teste-41"
    assert log["status"] == 200
    assert UUID(cliente.get("/health").headers["X-Correlation-Id"])


async def test_lifespan_fecha_recursos_apos_falha_parcial(cliente, monkeypatch):
    from app import main

    redis = SimpleNamespace(aclose=AsyncMock(), register_script=MagicMock())
    monkeypatch.setattr(main, "configurar_logging", lambda: None)
    monkeypatch.setenv("NOTIFICACOES_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("NOTIFICACOES_AMQP_URL", "amqp://localhost/")
    monkeypatch.setenv("JWT_PUBLIC_KEY", "chave-de-teste")
    main.get_settings.cache_clear()
    monkeypatch.setattr(main.Redis, "from_url", lambda *_a, **_kw: redis)
    monkeypatch.setattr(main.aio_pika, "connect_robust", AsyncMock(side_effect=OSError()))
    try:
        with pytest.raises(OSError):
            async with lifespan(cliente.app):
                pass
        redis.aclose.assert_awaited_once()
    finally:
        main.get_settings.cache_clear()


async def test_lifespan_abre_no_inicio_e_fecha_no_fim(cliente, monkeypatch):
    from app import main

    redis = SimpleNamespace(aclose=AsyncMock(), register_script=MagicMock())
    canal = MagicMock()
    rabbit = SimpleNamespace(close=AsyncMock(), channel=lambda: canal)
    iniciar = AsyncMock()
    monkeypatch.setattr(main.consumidor, "iniciar", iniciar)
    monkeypatch.setattr(main.consumidor, "alertar_dlq", AsyncMock())
    monkeypatch.setattr(main, "configurar_logging", lambda: None)
    monkeypatch.setenv("NOTIFICACOES_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("NOTIFICACOES_AMQP_URL", "amqp://localhost/")
    monkeypatch.setenv("JWT_PUBLIC_KEY", "chave-de-teste")
    main.get_settings.cache_clear()
    monkeypatch.setattr(main.Redis, "from_url", lambda *_a, **_kw: redis)
    conectar = AsyncMock(return_value=rabbit)
    monkeypatch.setattr(main.aio_pika, "connect_robust", conectar)
    try:
        async with lifespan(cliente.app):
            assert cliente.app.state.redis is redis
            assert cliente.app.state.rabbit is rabbit
            rabbit.close.assert_not_awaited()
            iniciar.assert_awaited_once_with(canal.__aenter__.return_value, cliente.app.state.caixa)
        canal.__aexit__.assert_awaited_once()
        rabbit.close.assert_awaited_once()
        redis.aclose.assert_awaited_once()
    finally:
        main.get_settings.cache_clear()
