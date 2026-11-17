"""Participante da SAGA: transação → resposta confirmada → ACK do consumidor."""

import json
import logging
import uuid
from datetime import UTC, datetime

from aio_pika import DeliveryMode, Message
from bson import ObjectId
from pymongo import ReturnDocument

from app.repositorio.animais import montar_evento_outbox

logger = logging.getLogger(__name__)
COMANDOS = {"ReservarAnimal", "LiberarReserva", "ConfirmarAdocao"}


def validar(evento):
    if evento["type"] not in COMANDOS or evento["version"] != 1:
        raise ValueError("Comando ou versão desconhecido")
    uuid.UUID(evento["messageId"])
    uuid.UUID(evento["sagaId"])
    if not isinstance(evento["correlationId"], str):
        raise ValueError("correlationId obrigatório")
    if not ObjectId.is_valid(evento["payload"]["animalId"]):
        raise ValueError("animalId inválido")
    if evento["type"] == "ConfirmarAdocao":
        uuid.UUID(evento["payload"]["adotanteId"])


async def processar(cliente, banco, evento):
    validar(evento)
    saga_id, animal_id = evento["sagaId"], evento["payload"]["animalId"]
    identificador = ObjectId(animal_id)

    async def transacao(sessao):
        inbox = await banco.inbox.find_one({"_id": evento["messageId"]}, session=sessao)
        if inbox:
            return inbox["resposta"]
        # Reserva e compensação da MESMA saga disputam o mesmo documento, inclusive
        # quando a C1 chega antes da T1. O retry da transação resolve write conflicts.
        marca = await banco.sagas_compensadas.find_one_and_update(
            {"_id": saga_id},
            {"$setOnInsert": {"encerrada": False}, "$inc": {"version": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
            session=sessao,
        )
        agora = datetime.now(UTC)
        mudou = None
        comando = evento["type"]

        async def transicionar(de, para):
            filtro = {"_id": identificador, "status": de}
            if de == "RESERVADO":
                filtro["reservaSagaId"] = saga_id
            return await banco.animais.find_one_and_update(
                filtro,
                {
                    "$set": {
                        "status": para,
                        "atualizadoEm": agora,
                        "reservaSagaId": None if para == "DISPONIVEL" else saga_id,
                    },
                    "$inc": {"version": 1},
                    "$push": {
                        "historicoStatus": {
                            "status": para,
                            "motivo": comando,
                            "alteradoEm": agora,
                            "alteradoPor": "SAGA",
                            "sagaId": saga_id,
                        }
                    },
                },
                return_document=ReturnDocument.AFTER,
                session=sessao,
            )

        if comando == "ReservarAnimal":
            if marca["encerrada"]:
                tipo, payload = (
                    "ReservaRecusada",
                    {"animalId": animal_id, "motivo": "SAGA_ENCERRADA"},
                )
            else:
                mudou = await transicionar("DISPONIVEL", "RESERVADO")
                atual = mudou or await banco.animais.find_one(
                    {"_id": identificador}, session=sessao
                )
                if atual and atual["status"] == "RESERVADO" and atual["reservaSagaId"] == saga_id:
                    tipo, payload = (
                        "AnimalReservado",
                        {
                            "animalId": animal_id,
                            "responsavelId": atual["responsavelId"],
                            "animalNome": atual["nome"],
                        },
                    )
                else:
                    tipo, payload = (
                        "ReservaRecusada",
                        {
                            "animalId": animal_id,
                            "motivo": "INDISPONIVEL" if atual else "INEXISTENTE",
                        },
                    )
        elif comando == "LiberarReserva":
            await banco.sagas_compensadas.update_one(
                {"_id": saga_id},
                {"$set": {"encerrada": True}},
                session=sessao,
            )
            mudou = await transicionar("RESERVADO", "DISPONIVEL")
            tipo, payload = "ReservaLiberada", {"animalId": animal_id, "liberou": mudou is not None}
        else:
            mudou = await transicionar("RESERVADO", "ADOTADO")
            atual = mudou or await banco.animais.find_one({"_id": identificador}, session=sessao)
            if atual and atual["status"] == "ADOTADO" and atual.get("reservaSagaId") == saga_id:
                tipo, payload = "AdocaoConfirmada", {"animalId": animal_id}
            else:
                motivo = (
                    "RESERVA_DE_OUTRA_SAGA"
                    if atual and atual["status"] == "RESERVADO"
                    else "NAO_RESERVADO"
                )
                tipo, payload = "ConfirmacaoRecusada", {"animalId": animal_id, "motivo": motivo}
        resposta = {
            "messageId": str(uuid.uuid4()),
            "type": tipo,
            "version": 1,
            "correlationId": evento["correlationId"],
            "sagaId": saga_id,
            "occurredAt": agora.isoformat(),
            "payload": payload,
        }
        if mudou:
            outbox = montar_evento_outbox("animal.status_alterado", mudou)
            outbox.update(sagaId=saga_id, correlationId=evento["correlationId"])
            await banco.outbox.insert_one(outbox, session=sessao)
        await banco.inbox.insert_one(
            {"_id": evento["messageId"], "resposta": resposta, "created_at": agora},
            session=sessao,
        )
        return resposta

    async with cliente.start_session() as sessao:
        resposta = await sessao.with_transaction(transacao)
    logger.info(
        "comando processado",
        extra={
            "sagaId": saga_id,
            "correlationId": evento["correlationId"],
            "tipo": resposta["type"],
        },
    )
    return resposta


async def publicar(canal, resposta):
    exchange = await canal.get_exchange("ampara.respostas", ensure=False)
    confirmacao = await exchange.publish(
        Message(
            body=json.dumps(resposta).encode(),
            delivery_mode=DeliveryMode.PERSISTENT,
            content_type="application/json",
            message_id=resposta["messageId"],
            correlation_id=resposta["correlationId"],
            type=resposta["type"],
        ),
        routing_key="orquestrador",
        mandatory=True,
    )
    if confirmacao is False:
        raise ConnectionError("Broker recusou a resposta")


async def tratar_comando(cliente, banco, evento, canal):
    resposta = await processar(cliente, banco, evento)
    await publicar(canal, resposta)
