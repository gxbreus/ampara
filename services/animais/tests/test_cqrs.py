import base64
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pymongo.errors import DuplicateKeyError

from app.api.busca import publico
from app.dependencias import get_banco_leitura
from app.projetor import aplicar_evento, aproximar, projetar

ID = "6706e21b7a2d4b8e2194cf01"


def payload(version=1):
    return {
        "animalId": ID,
        "nome": "Thor",
        "status": "DISPONIVEL",
        "version": version,
        "responsavel": {"id": "ong", "nome": "Patas", "verificado": True},
        "pontoAproximado": {"type": "Point", "coordinates": [-44.9998, -21.2468]},
        "localizacao": {"coordinates": [-44.9998, -21.2468]},
        "endereco": "privado",
    }


def test_projecao_e_resposta_nao_expoem_localizacao_exata():
    original = payload()
    doc = projetar(original)
    assert doc["pontoAproximado"]["coordinates"] == [-45.0, -21.245]
    assert doc["pontoAproximado"] != original["pontoAproximado"]
    assert "localizacao" not in doc and "endereco" not in doc
    assert "pontoAproximado" not in publico(doc, detalhe=True)
    assert aproximar(*aproximar(-44.9998, -21.2468)) == aproximar(-44.9998, -21.2468)


async def test_evento_duplicado_ou_antigo_nao_sobrescreve():
    salvo = {}

    async def update(filtro, mudanca, upsert):
        doc = mudanca["$set"]
        if salvo and salvo["version"] >= doc["version"]:
            raise DuplicateKeyError("mesmo _id")
        salvo.update(doc)

    leitura = SimpleNamespace(animais_busca=SimpleNamespace(update_one=update))
    escrita = SimpleNamespace(responsaveis=SimpleNamespace(find_one=AsyncMock(return_value=None)))
    for versao in (3, 1, 3):
        await aplicar_evento(
            escrita,
            leitura,
            {
                "type": "animal.atualizado",
                "payload": payload(versao),
                "occurredAt": "2026-11-17T12:00:00Z",
                "correlationId": "c",
            },
        )
        assert salvo["version"] == 3


async def test_verificacao_alimenta_replica_e_todos_os_animais():
    escrita = SimpleNamespace(responsaveis=SimpleNamespace(update_one=AsyncMock()))
    leitura = SimpleNamespace(animais_busca=SimpleNamespace(update_many=AsyncMock()))
    await aplicar_evento(
        escrita,
        leitura,
        {
            "type": "conta.verificada",
            "payload": {"contaId": "ong", "nome": "Patas"},
        },
    )
    escrita.responsaveis.update_one.assert_awaited_once()
    leitura.animais_busca.update_many.assert_awaited_once_with(
        {"responsavel.id": "ong"},
        {"$set": {"responsavel": {"id": "ong", "nome": "Patas", "verificado": True}}},
    )


@pytest.mark.parametrize("query", ["", "?lat=0", "?lat=91&lng=0", "?lat=0&lng=0&limite=51"])
def test_busca_valida_parametros_sem_exigir_login(cliente, query):
    cliente.app.dependency_overrides[get_banco_leitura] = lambda: SimpleNamespace()
    assert cliente.get("/v1/animais/busca" + query).status_code == 422


def test_cursor_desempata_por_id_e_fica_vinculado_a_busca(cliente):
    documentos = [
        {**projetar(payload()), "distanciaMetros": 100},
        {**projetar(payload()), "_id": "6706e21b7a2d4b8e2194cf02", "distanciaMetros": 100},
    ]
    agregado = AsyncMock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=documentos)))
    banco = SimpleNamespace(animais_busca=SimpleNamespace(aggregate=agregado))
    cliente.app.dependency_overrides[get_banco_leitura] = lambda: banco
    resposta = cliente.get("/v1/animais/busca?lat=0&lng=0&limite=1")
    assert resposta.status_code == 200
    cursor = resposta.json()["proximoCursor"]
    assert json.loads(base64.urlsafe_b64decode(cursor))["id"] == ID
    assert cliente.get(f"/v1/animais/busca?lat=0&lng=0&cursor={cursor}").status_code == 200
    pipeline = agregado.call_args.args[0]
    assert pipeline[1]["$match"]["$or"][1] == {"distanciaMetros": 100, "_id": {"$gt": ID}}
    assert cliente.get(f"/v1/animais/busca?lat=1&lng=0&cursor={cursor}").status_code == 400
    assert cliente.get("/v1/animais/busca?lat=0&lng=0&cursor=%%%").status_code == 400


def test_detalhe_publico_inclui_reservado(cliente):
    doc = {**projetar(payload()), "status": "RESERVADO"}
    banco = SimpleNamespace(animais_busca=SimpleNamespace(find_one=AsyncMock(return_value=doc)))
    cliente.app.dependency_overrides[get_banco_leitura] = lambda: banco
    resposta = cliente.get(f"/v1/animais/busca/{ID}")
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "RESERVADO"
    assert "pontoAproximado" not in resposta.json()
