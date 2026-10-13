"""Worker em background para publicação de eventos do Outbox no RabbitMQ."""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

import aio_pika
from aio_pika import DeliveryMode, Message
from pymongo import ASCENDING
from pymongo.asynchronous.database import AsyncDatabase

logger = logging.getLogger(__name__)


class OutboxRelay:
    def __init__(self, banco: AsyncDatabase, rabbitmq_url: str, intervalo_segundos: float = 0.5):
        self.banco = banco
        self.rabbitmq_url = rabbitmq_url
        self.intervalo = intervalo_segundos
        self._parar = asyncio.Event()
        self._tarefa: asyncio.Task[None] | None = None

    def iniciar(self) -> None:
        if not self.rabbitmq_url:
            logger.warning("RABBITMQ_URL não configurada. Relay do Outbox não será iniciado.")
            return
        self._tarefa = asyncio.create_task(self._executar_loop())

    async def parar(self) -> None:
        self._parar.set()
        if self._tarefa:
            self._tarefa.cancel()
            try:
                await self._tarefa
            except asyncio.CancelledError:
                pass

    async def _executar_loop(self) -> None:
        logger.info("Iniciando loop do Relay Outbox de Animais.")
        while not self._parar.is_set():
            conexao = None
            try:
                conexao = await aio_pika.connect_robust(self.rabbitmq_url)
                canal = await conexao.channel(publisher_confirms=True)
                exchange = await canal.declare_exchange(
                    "ampara.eventos",
                    type=aio_pika.ExchangeType.TOPIC,
                    durable=True,
                )

                while not self._parar.is_set():
                    await self._processar_lote_pendente(exchange)
                    await asyncio.sleep(self.intervalo)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(
                    "Falha na conexão com o RabbitMQ no Outbox Relay. Tentando novamente em 3s...",
                    extra={"erro": str(e)},
                )
                await asyncio.sleep(3.0)
            finally:
                if conexao and not conexao.is_closed:
                    await conexao.close()

    async def _processar_lote_pendente(self, exchange: aio_pika.abc.AbstractExchange) -> None:
        cursor = (
            self.banco.outbox.find({"publicadoEm": None}).sort("criadoEm", ASCENDING).limit(100)
        )
        pendentes: list[dict[str, Any]] = await cursor.to_list(length=100)
        if not pendentes:
            return

        for doc in pendentes:
            try:
                corpo = json.dumps(doc["payload"]).encode("utf-8")
                mensagem = Message(
                    body=corpo,
                    delivery_mode=DeliveryMode.PERSISTENT,
                    content_type="application/json",
                    message_id=doc.get("messageId"),
                    type=doc.get("type"),
                )

                # Publicação com publisher confirms garantida pelo canal
                confirmacao = await exchange.publish(
                    mensagem,
                    routing_key=doc.get("routingKey", "animal.evento"),
                )

                if confirmacao is False:
                    logger.warning(
                        "Mensagem não confirmada pelo broker (NACK).",
                        extra={"docId": str(doc["_id"])},
                    )
                    continue

                agora = datetime.now(UTC)
                await self.banco.outbox.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"publicadoEm": agora}},
                )
                logger.info(
                    "Evento do Outbox publicado com sucesso.",
                    extra={"tipo": doc.get("type"), "messageId": doc.get("messageId")},
                )
            except Exception as err:
                logger.error(
                    "Erro ao publicar evento do Outbox; permanecerá pendente.",
                    extra={"docId": str(doc["_id"]), "erro": str(err)},
                )
                break
