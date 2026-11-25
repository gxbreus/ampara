"""Consumo com reconexão, filas preexistentes e ACK só após o efeito."""

import asyncio
import json
import logging
from contextlib import suppress

import aio_pika

logger = logging.getLogger(__name__)


class Consumidor:
    def __init__(self, url, fila, tratar):
        self.url, self.fila, self.tratar = url, fila, tratar
        self.tarefa = None

    def iniciar(self):
        if self.url:
            self.tarefa = asyncio.create_task(self.executar())

    async def parar(self):
        if self.tarefa:
            self.tarefa.cancel()
            with suppress(asyncio.CancelledError):
                await self.tarefa

    async def executar(self):
        while True:
            try:
                async with await aio_pika.connect_robust(self.url) as conexao:
                    canal = await conexao.channel(publisher_confirms=True)
                    await canal.set_qos(prefetch_count=10)
                    fila = await canal.get_queue(self.fila, ensure=False)
                    async with fila.iterator() as mensagens:
                        async for mensagem in mensagens:
                            try:
                                evento = json.loads(mensagem.body)
                                if evento["version"] != 1:
                                    await mensagem.reject(requeue=False)
                                    continue
                                await self.tratar(evento, canal)
                            except (ValueError, KeyError, TypeError):
                                logger.exception("mensagem inválida", extra={"fila": self.fila})
                                await mensagem.reject(requeue=False)
                            except Exception:
                                logger.exception("falha transitória", extra={"fila": self.fila})
                                await mensagem.nack(requeue=True)
                            else:
                                await mensagem.ack()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("consumidor desconectado", extra={"fila": self.fila})
                await asyncio.sleep(3)
