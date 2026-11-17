"""Integração real: ANIMAIS_TEST_MONGO_URL deve apontar a um replica set de teste."""

import asyncio
import os
import uuid

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient

from app.saga import processar


@pytest.mark.skipif(
    not os.getenv("ANIMAIS_TEST_MONGO_URL"), reason="Mongo replica set indisponível"
)
async def test_vinte_reservas_no_mongo_real():
    cliente = AsyncMongoClient(os.environ["ANIMAIS_TEST_MONGO_URL"])
    banco = cliente[f"teste_saga_{uuid.uuid4().hex}"]
    animal_id = ObjectId()
    try:
        for nome in ("animais", "inbox", "outbox", "sagas_compensadas"):
            await banco.create_collection(nome)
        await banco.animais.insert_one(
            {
                "_id": animal_id,
                "nome": "Thor",
                "responsavelId": str(uuid.uuid4()),
                "status": "DISPONIVEL",
                "version": 1,
                "especie": "CAO",
                "porte": "MEDIO",
                "idadeMeses": 12,
            }
        )
        comandos = [
            {
                "messageId": str(uuid.uuid4()),
                "sagaId": str(uuid.uuid4()),
                "type": "ReservarAnimal",
                "version": 1,
                "correlationId": "teste-real",
                "payload": {"animalId": str(animal_id)},
            }
            for _ in range(20)
        ]
        respostas = await asyncio.gather(*(processar(cliente, banco, c) for c in comandos))
        assert sum(r["type"] == "AnimalReservado" for r in respostas) == 1
        assert sum(r["type"] == "ReservaRecusada" for r in respostas) == 19
        assert await banco.outbox.count_documents({}) == 1
        assert await banco.inbox.count_documents({}) == 20
        repetida = await processar(cliente, banco, comandos[0])
        assert repetida == respostas[0]
    finally:
        await cliente.drop_database(banco.name)
        await cliente.close()
