"""Camada de repositório do serviço de Animais com transações atômicas e Outbox."""

import uuid
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.dominio.animal import OrigemTransicao, StatusAnimal, pode_transicionar
from app.problema import (
    erro_animal_nao_encontrado,
    erro_identificador_invalido,
    erro_lote_excedido,
    erro_sem_permissao,
    erro_status_exclusivo_saga,
)
from app.schemas.animal import AtualizarAnimalEntrada, NovoAnimalEntrada


def parse_object_id(id_str: str) -> ObjectId:
    try:
        return ObjectId(id_str)
    except (InvalidId, ValueError, TypeError) as err:
        raise erro_identificador_invalido(
            f"'{id_str}' não é um ObjectId hexadecimal válido de 24 caracteres."
        ) from err


def montar_evento_outbox(
    tipo: str,
    animal_doc: dict[str, Any],
    responsavel_nome: str = "",
) -> dict[str, Any]:
    agora = datetime.now(UTC)
    coords = animal_doc.get("localizacao", {}).get("coordinates", [0.0, 0.0])
    ponto_aproximado = {
        "type": "Point",
        "coordinates": [round(coords[0], 3), round(coords[1], 3)],
    }

    fotos = animal_doc.get("fotos", [])
    foto_capa = fotos[0] if fotos else None
    foto_thumb = fotos[0] if fotos else None

    atualizado_em = animal_doc.get("atualizadoEm", agora)
    if isinstance(atualizado_em, datetime):
        atualizado_em_iso = atualizado_em.isoformat()
    else:
        atualizado_em_iso = str(atualizado_em)

    payload = {
        "animalId": str(animal_doc["_id"]),
        "nome": animal_doc["nome"],
        "especie": animal_doc["especie"],
        "porte": animal_doc["porte"],
        "idadeMeses": animal_doc["idadeMeses"],
        "fotos": fotos,
        "fotoCapa": foto_capa,
        "fotoThumb": foto_thumb,
        "pontoAproximado": ponto_aproximado,
        "bairro": animal_doc.get("endereco", {}).get("bairro", ""),
        "cidade": animal_doc.get("endereco", {}).get("cidade", ""),
        "status": animal_doc["status"],
        "responsavel": {
            "id": animal_doc["responsavelId"],
            "nome": responsavel_nome or animal_doc.get("responsavelNome", ""),
            "verificado": True,
        },
        "version": animal_doc["version"],
        "atualizadoEm": atualizado_em_iso,
    }

    return {
        "messageId": str(uuid.uuid4()),
        "type": tipo,
        "exchange": "ampara.eventos",
        "routingKey": tipo,
        "payload": payload,
        "criadoEm": agora,
        "publicadoEm": None,
    }


def serializar_animal(doc: dict[str, Any]) -> dict[str, Any]:
    """Converte ObjectId para string e garante tipos corretos para Pydantic."""
    copia = dict(doc)
    copia["id"] = str(copia.pop("_id"))
    copia.pop("responsavelNome", None)
    return copia


async def cadastrar_animal(
    cliente: AsyncMongoClient,
    banco: AsyncDatabase,
    entrada: NovoAnimalEntrada,
    responsavel_id: str,
    responsavel_nome: str = "",
) -> dict[str, Any]:
    agora = datetime.now(UTC)
    novo_id = ObjectId()

    doc_animal = {
        "_id": novo_id,
        "responsavelId": responsavel_id,
        "responsavelNome": responsavel_nome,
        "nome": entrada.nome,
        "especie": entrada.especie.value,
        "porte": entrada.porte.value,
        "sexo": entrada.sexo.value,
        "idadeMeses": entrada.idadeMeses,
        "temperamento": entrada.temperamento,
        "descricao": entrada.descricao,
        "fotos": entrada.fotos,
        "localizacao": entrada.localizacao.model_dump(),
        "endereco": entrada.endereco.model_dump(),
        "status": StatusAnimal.DISPONIVEL.value,
        "reservaSagaId": None,
        "historicoStatus": [
            {
                "status": StatusAnimal.DISPONIVEL.value,
                "motivo": "Cadastro inicial do animal",
                "alteradoEm": agora,
                "alteradoPor": responsavel_id,
            }
        ],
        "version": 1,
        "criadoEm": agora,
        "atualizadoEm": agora,
    }

    evento_outbox = montar_evento_outbox(
        tipo="animal.criado",
        animal_doc=doc_animal,
        responsavel_nome=responsavel_nome,
    )

    # Transação atômica no replica set rs0
    async with cliente.start_session() as s:
        async with await s.start_transaction():
            await banco.animais.insert_one(doc_animal, session=s)
            await banco.outbox.insert_one(evento_outbox, session=s)

    return serializar_animal(doc_animal)


async def buscar_animal_por_id(
    banco: AsyncDatabase,
    animal_id: str,
    usuario_id: str,
    eh_admin: bool = False,
) -> dict[str, Any]:
    obj_id = parse_object_id(animal_id)
    doc = await banco.animais.find_one({"_id": obj_id})
    if not doc:
        raise erro_animal_nao_encontrado(animal_id)

    if not eh_admin and doc["responsavelId"] != usuario_id:
        raise erro_sem_permissao(
            "Você não tem permissão para visualizar os detalhes privados deste animal."
        )

    return serializar_animal(doc)


async def listar_animais_responsavel(
    banco: AsyncDatabase,
    responsavel_id: str,
    status_filtro: StatusAnimal | None = None,
    cursor: str | None = None,
    limite: int = 20,
) -> tuple[list[dict[str, Any]], str | None]:
    filtro: dict[str, Any] = {"responsavelId": responsavel_id}
    if status_filtro:
        filtro["status"] = status_filtro.value

    if cursor:
        filtro["_id"] = {"$gt": parse_object_id(cursor)}

    cursor_mongo = banco.animais.find(filtro).sort("_id", ASCENDING).limit(limite + 1)
    docs = await cursor_mongo.to_list(length=limite + 1)

    itens = docs[:limite]
    proximo_cursor = str(itens[-1]["_id"]) if len(docs) > limite and itens else None

    return [serializar_animal(d) for d in itens], proximo_cursor


async def buscar_animais_em_lote(
    banco: AsyncDatabase,
    ids: list[str],
) -> list[dict[str, Any]]:
    if len(ids) > 100:
        raise erro_lote_excedido(
            f"A consulta em lote aceita no máximo 100 IDs; recebidos {len(ids)}."
        )

    obj_ids = [parse_object_id(i) for i in ids]
    cursor_mongo = banco.animais.find({"_id": {"$in": obj_ids}})
    docs = await cursor_mongo.to_list(length=len(obj_ids))
    return [serializar_animal(d) for d in docs]


async def atualizar_animal(
    cliente: AsyncMongoClient,
    banco: AsyncDatabase,
    animal_id: str,
    entrada: AtualizarAnimalEntrada,
    usuario_id: str,
    eh_admin: bool = False,
) -> dict[str, Any]:
    obj_id = parse_object_id(animal_id)
    doc_atual = await banco.animais.find_one({"_id": obj_id})
    if not doc_atual:
        raise erro_animal_nao_encontrado(animal_id)

    if not eh_admin and doc_atual["responsavelId"] != usuario_id:
        raise erro_sem_permissao("Você não tem permissão para editar os dados deste animal.")

    campos_atualizar: dict[str, Any] = {}
    dados = entrada.model_dump(exclude_unset=True)
    for chave, valor in dados.items():
        if valor is not None:
            if hasattr(valor, "value"):
                campos_atualizar[chave] = valor.value
            else:
                campos_atualizar[chave] = valor

    if not campos_atualizar:
        return serializar_animal(doc_atual)

    agora = datetime.now(UTC)
    nova_versao = doc_atual.get("version", 1) + 1
    campos_atualizar["version"] = nova_versao
    campos_atualizar["atualizadoEm"] = agora

    doc_modificado = {**doc_atual, **campos_atualizar}
    evento_outbox = montar_evento_outbox(
        tipo="animal.atualizado",
        animal_doc=doc_modificado,
        responsavel_nome=doc_atual.get("responsavelNome", ""),
    )

    async with cliente.start_session() as s:
        async with await s.start_transaction():
            await banco.animais.update_one(
                {"_id": obj_id},
                {"$set": campos_atualizar},
                session=s,
            )
            await banco.outbox.insert_one(evento_outbox, session=s)

    return serializar_animal(doc_modificado)


async def atualizar_status_animal(
    cliente: AsyncMongoClient,
    banco: AsyncDatabase,
    animal_id: str,
    novo_status: StatusAnimal,
    motivo: str | None,
    usuario_id: str,
    eh_admin: bool = False,
) -> dict[str, Any]:
    obj_id = parse_object_id(animal_id)
    doc_atual = await banco.animais.find_one({"_id": obj_id})
    if not doc_atual:
        raise erro_animal_nao_encontrado(animal_id)

    if not eh_admin and doc_atual["responsavelId"] != usuario_id:
        raise erro_sem_permissao("Você não tem permissão para alterar o status deste animal.")

    status_atual = StatusAnimal(doc_atual["status"])

    # Validação estrita da máquina de estados do domínio
    if not pode_transicionar(status_atual, novo_status, OrigemTransicao.MANUAL):
        raise erro_status_exclusivo_saga(
            f"Transição de '{status_atual.value}' para '{novo_status.value}' não é permitida "
            "manualmente. Os status RESERVADO e ADOTADO só podem ser alterados pela SAGA "
            "de adoção via mensageria."
        )

    agora = datetime.now(UTC)
    nova_versao = doc_atual.get("version", 1) + 1
    novo_historico_item = {
        "status": novo_status.value,
        "motivo": motivo or "Alteração manual de status pelo responsável",
        "alteradoEm": agora,
        "alteradoPor": usuario_id,
    }

    campos_atualizar = {
        "status": novo_status.value,
        "version": nova_versao,
        "atualizadoEm": agora,
    }

    doc_modificado = {
        **doc_atual,
        **campos_atualizar,
        "historicoStatus": [*doc_atual.get("historicoStatus", []), novo_historico_item],
    }

    evento_outbox = montar_evento_outbox(
        tipo="animal.status_alterado",
        animal_doc=doc_modificado,
        responsavel_nome=doc_atual.get("responsavelNome", ""),
    )

    async with cliente.start_session() as s:
        async with await s.start_transaction():
            await banco.animais.update_one(
                {"_id": obj_id},
                {
                    "$set": campos_atualizar,
                    "$push": {"historicoStatus": novo_historico_item},
                },
                session=s,
            )
            await banco.outbox.insert_one(evento_outbox, session=s)

    return serializar_animal(doc_modificado)
