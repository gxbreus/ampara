"""Integração geográfica e reconstrução reais em databases isolados de teste."""

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient

from app.db import criar_indices
from app.dependencias import get_banco_leitura
from app.main import create_app
from app.projetor import aplicar_evento
from app.repositorio.animais import montar_evento_outbox

pytestmark = pytest.mark.skipif(
    not os.getenv("ANIMAIS_TEST_MONGO_URL"), reason="Mongo replica set indisponível"
)


@pytest.fixture
async def mongo():
    cliente = AsyncMongoClient(os.environ["ANIMAIS_TEST_MONGO_URL"])
    prefixo = "teste_cqrs_" + uuid.uuid4().hex
    escrita, leitura = cliente[prefixo], cliente[prefixo + "_leitura"]
    await criar_indices(escrita, leitura)
    try:
        yield cliente, escrita, leitura
    finally:
        await cliente.drop_database(escrita.name)
        await cliente.drop_database(leitura.name)
        await cliente.close()


def documento(coords, nome="Thor", version=1):
    return {
        "_id": ObjectId(),
        "nome": nome,
        "especie": "CAO",
        "porte": "MEDIO",
        "sexo": "MACHO",
        "idadeMeses": 12,
        "fotos": ["https://assets.ampara.dev/thor.webp"],
        "localizacao": {"type": "Point", "coordinates": coords},
        "endereco": {"bairro": "Centro", "cidade": "Lavras"},
        "status": "DISPONIVEL",
        "responsavelId": str(uuid.uuid4()),
        "responsavelNome": "Patas",
        "version": version,
        "atualizadoEm": datetime.now(UTC),
    }


async def publicar(escrita, leitura, doc):
    evento = montar_evento_outbox("animal.atualizado", doc)
    await aplicar_evento(
        escrita,
        leitura,
        {
            **evento,
            "occurredAt": evento["criadoEm"].isoformat(),
            "correlationId": "teste-real",
        },
    )


async def test_geo_near_cursor_e_status_no_mongo_real(mongo):
    _, escrita, leitura = mongo
    documentos = [
        documento(p)
        for p in ([-45.00012, -21.2454], [-45, -21.24], [-45, -21.24], [-45, -21.20], [-45, -20.0])
    ]
    for doc in documentos:
        await publicar(escrita, leitura, doc)
    app = create_app()
    app.dependency_overrides[get_banco_leitura] = lambda: leitura
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://teste"
    ) as api:
        itens, cursor = [], None
        while True:
            parametros = {"lat": -21.245, "lng": -45, "raioKm": 10, "limite": 2}
            if cursor:
                parametros["cursor"] = cursor
            resposta = await api.get("/v1/animais/busca", params=parametros)
            assert resposta.status_code == 200, resposta.text
            pagina = resposta.json()
            itens.extend(pagina["itens"])
            cursor = pagina["proximoCursor"]
            if not cursor:
                break
        assert len(itens) == len({a["id"] for a in itens}) == 4
        assert [a["distanciaKm"] for a in itens] == sorted(a["distanciaKm"] for a in itens)
        assert all(a["distanciaKm"] <= 10 for a in itens)
        reservado = {**documentos[0], "status": "RESERVADO", "version": 2}
        await publicar(escrita, leitura, reservado)
        busca = (await api.get("/v1/animais/busca?lat=-21.245&lng=-45&raioKm=10")).json()
        assert str(reservado["_id"]) not in {a["id"] for a in busca["itens"]}
        detalhe = await api.get(f"/v1/animais/busca/{reservado['_id']}")
        assert detalhe.json()["status"] == "RESERVADO"
        assert "pontoAproximado" not in detalhe.json()
    projetado = await leitura.animais_busca.find_one({"_id": str(documentos[0]["_id"])})
    assert "localizacao" not in projetado
    assert projetado["pontoAproximado"] != documentos[0]["localizacao"]


async def test_versao_duplicata_responsavel_e_rebuild_reais(mongo):
    _, escrita, leitura = mongo
    doc = documento([-45, -21.245], version=3)
    await escrita.animais.insert_one(doc)
    await publicar(escrita, leitura, doc)
    await publicar(escrita, leitura, {**doc, "version": 1, "nome": "Antigo"})
    await publicar(escrita, leitura, doc)
    atual = await leitura.animais_busca.find_one({"_id": str(doc["_id"])})
    assert atual["version"] == 3 and atual["nome"] == "Thor"
    await aplicar_evento(
        escrita,
        leitura,
        {
            "type": "conta.verificada",
            "payload": {
                "contaId": doc["responsavelId"],
                "nome": "ONG atualizada",
            },
        },
    )
    antes = await leitura.animais_busca.find({}).sort("_id", 1).to_list(length=None)
    assert antes[0]["responsavel"]["nome"] == "ONG atualizada"
    # Usa o próprio script de operação, com URLs exclusivas destes databases de teste.
    ambiente = dict(os.environ)
    url = urlsplit(os.environ["ANIMAIS_TEST_MONGO_URL"])
    ambiente["ANIMAIS_MONGO_URL"] = urlunsplit(url._replace(path="/" + escrita.name))
    ambiente["ANIMAIS_LEITURA_MONGO_URL"] = urlunsplit(url._replace(path="/" + leitura.name))
    script = Path(__file__).resolve().parents[1] / "scripts/reconstruir_projecao.py"
    processo = await asyncio.create_subprocess_exec(
        sys.executable,
        str(script),
        "--confirmar",
        env=ambiente,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await processo.communicate()
    assert processo.returncode == 0, stderr.decode()
    assert "1" in stdout.decode()
    depois = await leitura.animais_busca.find({}).sort("_id", 1).to_list(length=None)
    assert depois == antes
