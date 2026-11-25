"""Projeção de snapshots, monotônica por versão, sem coordenadas privadas."""

import logging
from datetime import UTC, datetime

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

CAMPOS = (
    "nome",
    "especie",
    "porte",
    "sexo",
    "idadeMeses",
    "temperamento",
    "descricao",
    "fotos",
    "fotoCapa",
    "fotoThumb",
    "bairro",
    "cidade",
    "status",
    "responsavel",
    "version",
    "atualizadoEm",
)


def aproximar(lng: float, lat: float) -> list[float]:
    return [round(round(lng / 0.005) * 0.005, 6), round(round(lat / 0.005) * 0.005, 6)]


def projetar(payload: dict) -> dict:
    doc = {campo: payload[campo] for campo in CAMPOS if campo in payload}
    doc["_id"] = payload["animalId"]
    doc["version"] = int(payload["version"])
    ponto = payload["pontoAproximado"]["coordinates"]
    doc["pontoAproximado"] = {"type": "Point", "coordinates": aproximar(*ponto)}
    return doc


async def aplicar_evento(escrita, leitura, evento: dict) -> None:
    payload = evento["payload"]
    if evento["type"] == "conta.verificada":
        responsavel = {"id": payload["contaId"], "nome": payload["nome"], "verificado": True}
        # Uma operação repetida tem o mesmo efeito. Não depende de HTTP à Identidade.
        await escrita.responsaveis.update_one(
            {"_id": responsavel["id"]}, {"$set": responsavel}, upsert=True
        )
        await leitura.animais_busca.update_many(
            {"responsavel.id": responsavel["id"]}, {"$set": {"responsavel": responsavel}}
        )
        return
    doc = projetar(payload)
    responsavel = await escrita.responsaveis.find_one({"_id": doc["responsavel"]["id"]})
    if responsavel:
        doc["responsavel"] = {k: responsavel[k] for k in ("id", "nome", "verificado")}
    try:
        await leitura.animais_busca.update_one(
            {
                "_id": doc["_id"],
                "$or": [{"version": {"$lt": doc["version"]}}, {"version": {"$exists": False}}],
            },
            {"$set": doc},
            upsert=True,
        )
    except DuplicateKeyError:
        pass  # Documento já existe com a mesma versão ou uma mais nova.
    instante = datetime.fromisoformat(evento["occurredAt"].replace("Z", "+00:00"))
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=UTC)
    logger.info(
        "projeção atualizada",
        extra={
            "defasagem_ms": (datetime.now(UTC) - instante).total_seconds() * 1000,
            "correlationId": evento["correlationId"],
            "sagaId": evento.get("sagaId"),
        },
    )
