import asyncio
import json
import logging
import os
from uuid import UUID, uuid4

import aio_pika
import pytest

from app import main
from app.consumidor import DLQ, FILA


async def test_broker_retem_eventos_e_preserva_dlq(
    dados_evento, chave_publica, monkeypatch, caplog
):
    redis_url = os.getenv("NOTIFICACOES_TEST_REDIS_URL")
    amqp_url = os.getenv("NOTIFICACOES_TEST_AMQP_URL")
    admin_url = os.getenv("NOTIFICACOES_TEST_AMQP_ADMIN_URL")
    if not all((redis_url, amqp_url, admin_url)):
        pytest.skip("requer Redis e RabbitMQ de teste com as filas da Ampara")
    monkeypatch.setenv("NOTIFICACOES_REDIS_URL", redis_url)
    monkeypatch.setenv("NOTIFICACOES_AMQP_URL", amqp_url)
    monkeypatch.setenv("JWT_PUBLIC_KEY", chave_publica.decode())
    monkeypatch.setattr(main, "configurar_logging", lambda: None)
    main.get_settings.cache_clear()

    pedido = dados_evento | {
        "messageId": str(uuid4()),
        "type": "adocao.aguardando_aprovacao",
        "occurredAt": "2026-11-17T14:00:00Z",
        "payload": dados_evento["payload"] | {"expiraEm": "2026-11-20T14:00:00Z"},
    }
    invalido = str(uuid4())
    try:
        admin = await aio_pika.connect(admin_url, timeout=5)
        async with admin, admin.channel() as canal:
            exchange = await canal.get_exchange("ampara.eventos", ensure=False)
            # Simula o relay do Orquestrador publicando com Notificações desligado.
            await exchange.publish(
                aio_pika.Message(
                    b"{",
                    message_id=invalido,
                    type=dados_evento["type"],
                    correlation_id=dados_evento["correlationId"],
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ),
                routing_key=dados_evento["type"],
            )
            for evento in (dados_evento, pedido, dados_evento):
                await exchange.publish(
                    aio_pika.Message(
                        json.dumps(evento).encode(),
                        message_id=evento["messageId"],
                        type=evento["type"],
                        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                    ),
                    routing_key=evento["type"],
                )

            app = main.create_app()
            adotante = UUID(dados_evento["payload"]["adotanteId"])
            responsavel = UUID(dados_evento["payload"]["responsavelId"])
            with caplog.at_level(logging.ERROR, logger="app.consumidor"):
                async with main.lifespan(app), asyncio.timeout(15):
                    while True:
                        caixa = app.state.caixa
                        pagina = await caixa.listar(adotante, False, 20, None)
                        outra = await caixa.listar(responsavel, False, 20, None)
                        alertas = [
                            log
                            for log in caplog.records
                            if getattr(log, "messageId", None) == invalido
                        ]
                        if pagina.naoLidas == outra.naoLidas == 2 and alertas:
                            break
                        await asyncio.sleep(0.1)
                    assert [item.tipo for item in pagina.itens] == [
                        dados_evento["type"],
                        pedido["type"],
                    ]
                    (alerta,) = alertas
                    assert alerta.type == dados_evento["type"]
                    assert alerta.filaDeOrigem == FILA
                    assert alerta.mortes == 1
                    assert alerta.motivo == "rejected"

                    await app.state.rabbit.reconnect()
                    terceiro = dados_evento | {
                        "messageId": str(uuid4()),
                        "type": "adocao.concluida",
                    }
                    await exchange.publish(
                        aio_pika.Message(json.dumps(terceiro).encode()),
                        routing_key=terceiro["type"],
                    )
                    while True:
                        terceira_pagina = await caixa.listar(adotante, False, 20, None)
                        if terceira_pagina.naoLidas == 3:
                            break
                        await asyncio.sleep(0.1)

            dlq = await canal.get_queue(DLQ, ensure=False)
            mensagens = []
            while (mensagem := await dlq.get(fail=False, timeout=5)) is not None:
                mensagens.append(mensagem)
            assert any(mensagem.message_id == invalido for mensagem in mensagens)
            for mensagem in mensagens:
                if mensagem.message_id == invalido:
                    await mensagem.ack()
                else:
                    await mensagem.nack(requeue=True)
    finally:
        main.get_settings.cache_clear()
