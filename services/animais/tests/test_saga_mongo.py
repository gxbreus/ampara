"""Integração real: ANIMAIS_TEST_MONGO_URL deve apontar a um replica set de teste."""

import asyncio
import os
import uuid
from types import SimpleNamespace

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient

from app.dominio.animal import StatusAnimal
from app.problema import ProblemaHttp
from app.repositorio.animais import atualizar_animal, atualizar_status_animal
from app.saga import processar
from app.schemas.animal import AtualizarAnimalEntrada


@pytest.mark.skipif(
    not os.getenv("ANIMAIS_TEST_MONGO_URL"), reason="Mongo replica set indisponível"
)
async def test_vinte_reservas_no_mongo_real(monkeypatch):
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
        vencedor = next(
            c for c, r in zip(comandos, respostas, strict=True) if r["type"] == "AnimalReservado"
        )

        def comando(tipo, saga_id=None, alvo=animal_id):
            return {
                "messageId": str(uuid.uuid4()),
                "sagaId": saga_id or str(uuid.uuid4()),
                "type": tipo,
                "version": 1,
                "correlationId": "teste-real",
                "payload": {"animalId": str(alvo), "adotanteId": str(uuid.uuid4())},
            }

        outra = await processar(cliente, banco, comando("LiberarReserva"))
        assert outra["payload"]["liberou"] is False
        outra = await processar(cliente, banco, comando("ConfirmarAdocao"))
        assert outra["payload"]["motivo"] == "RESERVA_DE_OUTRA_SAGA"
        confirmar = comando("ConfirmarAdocao", vencedor["sagaId"])
        assert (await processar(cliente, banco, confirmar))["type"] == "AdocaoConfirmada"
        await processar(cliente, banco, comando("LiberarReserva", vencedor["sagaId"]))
        assert (await banco.animais.find_one({"_id": animal_id}))["status"] == "ADOTADO"

        segundo = ObjectId()
        doc = await banco.animais.find_one({"_id": animal_id})
        await banco.animais.insert_one(
            {**doc, "_id": segundo, "status": "DISPONIVEL", "version": 1}
        )
        liberar = comando("LiberarReserva", alvo=segundo)
        await processar(cliente, banco, liberar)
        tardia = await processar(
            cliente, banco, comando("ReservarAnimal", liberar["sagaId"], segundo)
        )
        assert tardia["payload"]["motivo"] == "SAGA_ENCERRADA"
        assert (await banco.animais.find_one({"_id": segundo}))["status"] == "DISPONIVEL"

        # Intercala uma reserva real entre a leitura da API e a sua escrita.
        # Metadados/status manuais não podem sobrescrever a versão da SAGA.
        for operacao in ("status", "dados"):
            terceiro = ObjectId()
            await banco.animais.insert_one(
                {
                    **doc,
                    "_id": terceiro,
                    "status": "DISPONIVEL",
                    "version": 1,
                    "reservaSagaId": None,
                }
            )
            reservar = comando("ReservarAnimal", alvo=terceiro)

            class LeituraAntiga:
                def __init__(self, comando_intercalado):
                    self.comando = comando_intercalado

                async def find_one(self, filtro):
                    antigo = await banco.animais.find_one(filtro)
                    await processar(cliente, banco, self.comando)
                    return antigo

                async def update_one(self, *args, **kwargs):
                    return await banco.animais.update_one(*args, **kwargs)

            proxy = SimpleNamespace(animais=LeituraAntiga(reservar), outbox=banco.outbox)
            with pytest.raises(ProblemaHttp) as conflito:
                if operacao == "status":
                    await atualizar_status_animal(
                        cliente,
                        proxy,
                        str(terceiro),
                        StatusAnimal.EM_TRATAMENTO,
                        None,
                        doc["responsavelId"],
                    )
                else:
                    await atualizar_animal(
                        cliente,
                        proxy,
                        str(terceiro),
                        AtualizarAnimalEntrada(nome="Novo nome"),
                        doc["responsavelId"],
                    )
            assert conflito.value.status_code == 409
            reservado = await banco.animais.find_one({"_id": terceiro})
            assert reservado["status"] == "RESERVADO" and reservado["version"] == 2

        # Se o outbox falhar depois da mudança, a transação desfaz também reserva e inbox.
        falha = comando("ReservarAnimal", alvo=segundo)

        def quebrar(*_args, **_kwargs):
            raise RuntimeError("falha simulada de outbox")

        monkeypatch.setattr("app.saga.montar_evento_outbox", quebrar)
        with pytest.raises(RuntimeError, match="outbox"):
            await processar(cliente, banco, falha)
        assert (await banco.animais.find_one({"_id": segundo}))["status"] == "DISPONIVEL"
        assert await banco.inbox.find_one({"_id": falha["messageId"]}) is None
    finally:
        await cliente.drop_database(banco.name)
        await cliente.close()
