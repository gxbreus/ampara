"""Consultas públicas exclusivamente no banco de leitura."""

import base64
import hashlib
import json
import math
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from app.dependencias import BancoLeitura
from app.dominio.animal import EspecieAnimal, PorteAnimal, SexoAnimal
from app.problema import erro_animal_nao_encontrado
from app.repositorio.animais import parse_object_id

router = APIRouter(prefix="/v1/animais/busca", tags=["Busca de Animais"])


def publico(doc: dict, detalhe=False) -> dict:
    campos = [
        "nome",
        "especie",
        "porte",
        "sexo",
        "idadeMeses",
        "fotoCapa",
        "fotoThumb",
        "bairro",
        "cidade",
        "responsavel",
        "status",
        "version",
        "atualizadoEm",
    ]
    if detalhe:
        campos += ["fotos", "temperamento", "descricao"]
    resultado = {k: doc[k] for k in campos if k in doc}
    resultado["id"] = str(doc["_id"])
    if "distanciaMetros" in doc:
        resultado["distanciaKm"] = round(doc["distanciaMetros"] / 1000, 3)
    return resultado


@router.get("")
async def buscar(
    banco: BancoLeitura,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    raioKm: Annotated[float, Query(ge=1, le=100)] = 10,
    limite: Annotated[int, Query(ge=1, le=50)] = 20,
    especie: EspecieAnimal | None = None,
    porte: PorteAnimal | None = None,
    sexo: SexoAnimal | None = None,
    idadeMaxMeses: Annotated[int | None, Query(ge=0)] = None,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
):
    filtro = {"status": "DISPONIVEL"}
    for chave, valor in (("especie", especie), ("porte", porte), ("sexo", sexo)):
        if valor:
            filtro[chave] = valor.value
    if idadeMaxMeses is not None:
        filtro["idadeMeses"] = {"$lte": idadeMaxMeses}
    assinatura = hashlib.sha256(json.dumps([lat, lng, raioKm, filtro], sort_keys=True).encode())
    chave = assinatura.hexdigest()
    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "key": "pontoAproximado",
                "distanceField": "distanciaMetros",
                "maxDistance": raioKm * 1000,
                "spherical": True,
                "query": filtro,
            }
        }
    ]
    if cursor:
        try:
            dados = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            distancia, identificador = float(dados["d"]), dados["id"]
            if dados["q"] != chave or not math.isfinite(distancia) or distancia < 0:
                raise ValueError("cursor de outra busca")
            parse_object_id(identificador)
        except (ValueError, KeyError, TypeError, HTTPException) as err:
            raise HTTPException(400, "Cursor inválido para esta busca.") from err
        pipeline.append(
            {
                "$match": {
                    "$or": [
                        {"distanciaMetros": {"$gt": distancia}},
                        {"distanciaMetros": distancia, "_id": {"$gt": identificador}},
                    ]
                }
            }
        )
    pipeline.extend([{"$sort": {"distanciaMetros": 1, "_id": 1}}, {"$limit": limite + 1}])
    docs = await (await banco.animais_busca.aggregate(pipeline)).to_list(length=limite + 1)
    pagina = docs[:limite]
    proximo = None
    if len(docs) > limite:
        ultimo = pagina[-1]
        proximo = base64.urlsafe_b64encode(
            json.dumps(
                {
                    "d": ultimo["distanciaMetros"],
                    "id": ultimo["_id"],
                    "q": chave,
                }
            ).encode()
        ).decode()
    return {"itens": [publico(d) for d in pagina], "proximoCursor": proximo}


@router.get("/{id}")
async def detalhe(id: str, banco: BancoLeitura):
    parse_object_id(id)
    doc = await banco.animais_busca.find_one({"_id": id})
    if not doc:
        raise erro_animal_nao_encontrado(id)
    return publico(doc, detalhe=True)
