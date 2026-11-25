import asyncio
import copy
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId

from app.saga import processar, publicar, validar

ID = "6706e21b7a2d4b8e2194cf01"


def evento(tipo="ReservarAnimal", saga=None):
    return {
        "messageId": str(uuid.uuid4()),
        "type": tipo,
        "version": 1,
        "sagaId": saga or str(uuid.uuid4()),
        "correlationId": "c",
        "payload": {"animalId": ID, "adotanteId": str(uuid.uuid4())},
    }


class Colecao:
    def __init__(self, docs=()):
        self.docs = {d["_id"]: copy.deepcopy(d) for d in docs}

    async def find_one(self, filtro, **_):
        doc = self.docs.get(filtro["_id"])
        return copy.deepcopy(doc) if doc else None

    async def insert_one(self, doc, **_):
        self.docs[doc.get("_id", doc.get("messageId"))] = copy.deepcopy(doc)

    async def update_one(self, filtro, update, **kwargs):
        return await self.find_one_and_update(filtro, update, **kwargs)

    async def find_one_and_update(self, filtro, update, upsert=False, **_):
        doc = self.docs.get(filtro["_id"])
        if doc is None and upsert:
            doc = {"_id": filtro["_id"], **update.get("$setOnInsert", {})}
        if doc is None or any(doc.get(k) != v for k, v in filtro.items()):
            return None
        doc.update(update.get("$set", {}))
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v
        for k, v in update.get("$push", {}).items():
            doc.setdefault(k, []).append(v)
        self.docs[doc["_id"]] = doc
        return copy.deepcopy(doc)


@pytest.fixture
def ambiente():
    lock = asyncio.Lock()

    class Sessao:
        async def with_transaction(self, callback):
            async with lock:
                return await callback(self)

    @asynccontextmanager
    async def sessao():
        yield Sessao()

    banco = SimpleNamespace(
        animais=Colecao(
            [
                {
                    "_id": ObjectId(ID),
                    "nome": "Thor",
                    "responsavelId": "ong",
                    "status": "DISPONIVEL",
                    "version": 1,
                    "especie": "CAO",
                    "porte": "MEDIO",
                    "idadeMeses": 12,
                }
            ]
        ),
        inbox=Colecao(),
        sagas_compensadas=Colecao(),
        outbox=Colecao(),
    )
    return SimpleNamespace(start_session=sessao), banco


async def test_vinte_reservas_concorrentes_tem_um_vencedor(ambiente):
    respostas = await asyncio.gather(*(processar(*ambiente, evento()) for _ in range(20)))
    assert sum(r["type"] == "AnimalReservado" for r in respostas) == 1
    assert sum(r["type"] == "ReservaRecusada" for r in respostas) == 19


async def test_compensacao_precautoria_impede_reserva_atrasada(ambiente):
    compensar = evento("LiberarReserva")
    await processar(*ambiente, compensar)
    resposta = await processar(*ambiente, evento(saga=compensar["sagaId"]))
    assert resposta["payload"]["motivo"] == "SAGA_ENCERRADA"


async def test_outra_saga_nao_libera_nem_confirma(ambiente):
    await processar(*ambiente, evento())
    assert not (await processar(*ambiente, evento("LiberarReserva")))["payload"]["liberou"]
    assert (await processar(*ambiente, evento("ConfirmarAdocao")))["payload"][
        "motivo"
    ] == "RESERVA_DE_OUTRA_SAGA"


async def test_duplicata_republica_mesma_resposta_e_confirmacao_e_final(ambiente):
    reservar = evento()
    primeira = await processar(*ambiente, reservar)
    assert await processar(*ambiente, reservar) == primeira
    assert len(ambiente[1].outbox.docs) == 1
    confirmar = evento("ConfirmarAdocao", reservar["sagaId"])
    assert (await processar(*ambiente, confirmar))["type"] == "AdocaoConfirmada"
    assert (await processar(*ambiente, evento()))["type"] == "ReservaRecusada"
    animal = ambiente[1].animais.docs[ObjectId(ID)]
    assert animal["status"] == "ADOTADO"
    assert all(item["sagaId"] == reservar["sagaId"] for item in animal["historicoStatus"])


async def test_confirmar_sem_reserva_e_liberacao_repetida(ambiente):
    assert (await processar(*ambiente, evento("ConfirmarAdocao")))["payload"][
        "motivo"
    ] == "NAO_RESERVADO"
    liberar = evento("LiberarReserva")
    assert not (await processar(*ambiente, liberar))["payload"]["liberou"]
    assert not (await processar(*ambiente, evento("LiberarReserva", liberar["sagaId"])))["payload"][
        "liberou"
    ]


async def test_publicacao_exige_confirmacao_e_rota_atual_do_orquestrador():
    exchange = SimpleNamespace(publish=AsyncMock(return_value=False))
    canal = SimpleNamespace(get_exchange=AsyncMock(return_value=exchange))
    resposta = {**evento(), "occurredAt": "2026-11-17T12:00:00Z"}
    with pytest.raises(ConnectionError):
        await publicar(canal, resposta)
    assert exchange.publish.call_args.kwargs["routing_key"] == "orquestrador"


def test_comando_invalido_e_rejeitado():
    with pytest.raises(ValueError):
        validar(evento("NaoExiste"))
