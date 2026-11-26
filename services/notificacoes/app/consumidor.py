"""Consumo da fila de eventos e alerta operacional da sua DLQ."""

import asyncio
import hashlib
import json
import logging
from functools import partial

from aio_pika.abc import AbstractIncomingMessage, AbstractRobustChannel, AbstractRobustConnection
from aio_pika.exceptions import AMQPError
from pydantic import ValidationError
from redis.exceptions import RedisError

from app.caixa import Caixa
from app.eventos import Evento, destinatarios

logger = logging.getLogger(__name__)
FILA = "notificacoes.eventos"
DLQ = f"{FILA}.dlq"


def _metadados(mensagem: AbstractIncomingMessage) -> dict:
    try:
        corpo = json.loads(mensagem.body)
    except ValueError:
        corpo = None
    dados = corpo if isinstance(corpo, dict) else {}
    return {
        "messageId": mensagem.message_id or dados.get("messageId"),
        "type": mensagem.type or dados.get("type"),
        "correlationId": mensagem.correlation_id or dados.get("correlationId"),
        "sagaId": dados.get("sagaId"),
    }


async def processar(mensagem: AbstractIncomingMessage, *, caixa: Caixa) -> None:
    try:
        evento = Evento.model_validate_json(mensagem.body)
        notificacoes = destinatarios(evento)
    except ValidationError:
        logger.warning("evento inválido", extra={"fila": FILA, **_metadados(mensagem)})
        await mensagem.nack(requeue=False)
        return

    extra = {
        "correlationId": evento.correlationId,
        "messageId": str(evento.messageId),
        "type": evento.type,
        "fila": FILA,
    }
    try:
        for notificacao in notificacoes:
            await caixa.gravar(evento, notificacao)
    except RedisError:
        logger.warning("Redis indisponível ao gravar notificação", extra=extra)
        await mensagem.nack(requeue=True)
        return

    await mensagem.ack()
    logger.info("evento de notificação processado", extra=extra)


async def iniciar(canal: AbstractRobustChannel, caixa: Caixa) -> None:
    await canal.set_qos(prefetch_count=20, timeout=5)
    processar_evento = partial(processar, caixa=caixa)

    async def inscrever(canal_reaberto: AbstractRobustChannel) -> None:
        fila = await canal_reaberto.get_queue(FILA, ensure=False)
        await fila.consume(processar_evento, no_ack=False, timeout=5, robust=False)

    # get_queue(ensure=False) não registra a fila para restauração. Reinscreva
    # o consumidor no canal restaurado, sem exigir permissão de declaração no broker.
    canal.reopen_callbacks.add(inscrever)
    await inscrever(canal)


async def _inspecionar_dlq(rabbit: AbstractRobustConnection, vistas: set[str]) -> set[str]:
    presentes: set[str] = set()
    async with rabbit.channel() as canal:
        fila = await canal.get_queue(DLQ, ensure=False)
        ultima = None
        while (mensagem := await fila.get(fail=False, timeout=5)) is not None:
            ultima = mensagem
            metadados = _metadados(mensagem)
            id_mensagem = metadados["messageId"]
            chave = (
                id_mensagem
                if isinstance(id_mensagem, str) and id_mensagem
                else hashlib.sha256(mensagem.body).hexdigest()
            )
            if chave not in vistas and chave not in presentes:
                mortes = mensagem.headers.get("x-death", [])
                morte = mortes[0] if isinstance(mortes, list) and mortes else None
                morte = morte if isinstance(morte, dict) else {}
                logger.error(
                    "mensagem na DLQ de Notificações",
                    extra={
                        **metadados,
                        "fila": DLQ,
                        "filaDeOrigem": morte.get("queue", FILA),
                        "motivo": morte.get("reason"),
                        "mortes": morte.get("count"),
                    },
                )
            presentes.add(chave)
        if ultima is not None:
            # Mantém as mensagens na DLQ para inspeção e intervenção com scripts/dlq.sh.
            await ultima.nack(multiple=True, requeue=True)
    return presentes


async def alertar_dlq(rabbit: AbstractRobustConnection) -> None:
    vistas: set[str] = set()
    while True:
        try:
            async with asyncio.timeout(10):
                vistas = await _inspecionar_dlq(rabbit, vistas)
        except (AMQPError, OSError, TimeoutError):
            logger.warning("não foi possível inspecionar a DLQ", extra={"fila": DLQ})
        await asyncio.sleep(10)
