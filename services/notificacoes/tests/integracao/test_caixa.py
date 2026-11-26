import asyncio
import json
import os
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis

from app.caixa import CAPACIDADE, Caixa
from app.config import Settings, get_settings
from app.dependencias import get_caixa
from app.eventos import Evento, destinatarios
from app.main import create_app

ROTA = "/v1/notificacoes"


@pytest.fixture
async def caixa_redis():
    url = os.getenv("NOTIFICACOES_TEST_REDIS_URL")
    if not url:
        pytest.skip("defina NOTIFICACOES_TEST_REDIS_URL para usar Redis real")
    async with Redis.from_url(url, decode_responses=True) as redis:
        yield Caixa(redis)


async def entregar(caixa, dados):
    evento = Evento.model_validate_json(json.dumps(dados))
    for aviso in destinatarios(evento):
        await caixa.gravar(evento, aviso)


@pytest.fixture
async def api(caixa_redis, chave_publica):
    app = create_app()
    config = Settings.model_validate(
        {
            "JWT_PUBLIC_KEY": chave_publica.decode(),
            "redis_url": "redis://localhost/0",
            "amqp_url": "amqp://localhost/",
        }
    )
    app.dependency_overrides[get_settings] = lambda: config
    app.dependency_overrides[get_caixa] = lambda: caixa_redis
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://teste") as cliente:
        yield cliente


async def test_fluxo_ordenado_com_reentrega_e_leitura_isolada(
    api, caixa_redis, token, dados_evento
):
    adotante = token(dados_evento["payload"]["adotanteId"])
    ong = token(dados_evento["payload"]["responsavelId"])
    pedido = dados_evento | {
        "messageId": str(uuid4()),
        "type": "adocao.aguardando_aprovacao",
        "occurredAt": "2026-11-17T14:00:00Z",
        "payload": dados_evento["payload"] | {"expiraEm": "2026-11-20T14:00:00Z"},
    }
    await asyncio.gather(entregar(caixa_redis, dados_evento), entregar(caixa_redis, dados_evento))
    await entregar(caixa_redis, pedido)

    resposta = await api.get(ROTA, headers=adotante)
    assert resposta.status_code == 200
    pagina = resposta.json()
    assert pagina["naoLidas"] == 2
    assert [item["tipo"] for item in pagina["itens"]] == [dados_evento["type"], pedido["type"]]
    id_item = pagina["itens"][0]["id"]
    caixa_ong = (await api.get(ROTA, headers=ong)).json()
    assert caixa_ong["naoLidas"] == 2
    assert caixa_ong["itens"][1]["titulo"] == "Nova solicitação"
    assert all(item["id"] != id_item for item in caixa_ong["itens"])
    alheia = await api.post(f"{ROTA}/{id_item}/leitura", headers=ong)
    inexistente = await api.post(f"{ROTA}/inexistente/leitura", headers=ong)
    assert alheia.status_code == inexistente.status_code == 404
    assert alheia.json() == inexistente.json()

    leituras = await asyncio.gather(
        api.post(f"{ROTA}/{id_item}/leitura", headers=adotante),
        api.post(f"{ROTA}/{id_item}/leitura", headers=adotante),
    )
    assert all(leitura.status_code == 204 and not leitura.content for leitura in leituras)
    nao_lidas = (await api.get(f"{ROTA}?naoLidas=true", headers=adotante)).json()
    assert nao_lidas["naoLidas"] == len(nao_lidas["itens"]) == 1
    assert nao_lidas["itens"][0]["tipo"] == pedido["type"]
    assert (await api.post(f"{ROTA}/leitura-todas", headers=adotante)).status_code == 204
    assert (await api.get(f"{ROTA}?naoLidas=true", headers=adotante)).json() == {
        "itens": [],
        "proximoCursor": None,
        "naoLidas": 0,
    }
    assert (await api.get(ROTA, headers=ong)).json()["naoLidas"] == 2


async def test_cursor_com_50_itens_empate_e_evento_novo(api, caixa_redis, token, dados_evento):
    usuario = dados_evento["payload"]["adotanteId"]
    for posicao in range(50):
        await entregar(caixa_redis, dados_evento | {"messageId": str(UUID(int=posicao))})
    headers = token(usuario)
    pagina = (await api.get(ROTA, params={"limite": 20}, headers=headers)).json()
    cursor = pagina["proximoCursor"]
    itens = pagina["itens"]
    assert len(itens) == 20
    assert pagina["naoLidas"] == 50
    assert (
        await api.get(ROTA, params={"cursor": cursor}, headers=token(uuid4()))
    ).status_code == 400
    params = {"cursor": cursor, "naoLidas": "true"}
    assert (await api.get(ROTA, params=params, headers=headers)).status_code == 400
    assert (await api.get(ROTA, params={"cursor": "abc"}, headers=headers)).status_code == 400

    await entregar(
        caixa_redis,
        dados_evento | {"messageId": str(uuid4()), "occurredAt": "2026-11-18T00:00:00Z"},
    )
    while cursor:
        resposta = await api.get(ROTA, params={"cursor": cursor, "limite": 20}, headers=headers)
        assert resposta.status_code == 200
        pagina = resposta.json()
        itens.extend(pagina["itens"])
        cursor = pagina["proximoCursor"]
    assert [item["id"] for item in itens] == [
        f"{UUID(int=posicao)}:{usuario}" for posicao in reversed(range(50))
    ]


async def test_capacidade_preserva_contador_ao_expulsar_lidas_e_nao_lidas(
    caixa_redis, dados_evento
):
    usuario = UUID(dados_evento["payload"]["adotanteId"])
    for posicao in range(CAPACIDADE):
        await entregar(caixa_redis, dados_evento | {"messageId": str(UUID(int=posicao))})
    primeiro = f"{UUID(int=0)}:{usuario}"
    assert await caixa_redis.marcar_lida(usuario, primeiro)
    for posicao in range(CAPACIDADE, CAPACIDADE + 2):
        await entregar(caixa_redis, dados_evento | {"messageId": str(UUID(int=posicao))})
    # Um evento atrasado pode chegar depois de a janela de 200 itens já estar cheia.
    await entregar(caixa_redis, dados_evento | {"occurredAt": "2026-11-16T00:00:00Z"})
    pagina = await caixa_redis.listar(usuario, False, CAPACIDADE, None)
    assert len(pagina.itens) == pagina.naoLidas == CAPACIDADE
    assert not await caixa_redis.marcar_lida(usuario, primeiro)


async def test_ordem_preserva_os_nanossegundos_do_orquestrador(caixa_redis, dados_evento):
    usuario = UUID(dados_evento["payload"]["adotanteId"])
    mais_novo = dados_evento | {
        "messageId": str(UUID(int=1)),
        "occurredAt": "2026-11-17T15:00:00.000000002Z",
    }
    mais_antigo = dados_evento | {
        "messageId": str(UUID(int=2)),
        "occurredAt": "2026-11-17T12:00:00.000000001-03:00",
    }
    await entregar(caixa_redis, mais_novo)
    await entregar(caixa_redis, mais_antigo)
    primeira = await caixa_redis.listar(usuario, False, 1, None)
    proxima = await caixa_redis.listar(usuario, False, 1, primeira.proximoCursor)
    assert primeira.itens[0].id == f"{mais_novo['messageId']}:{usuario}"
    assert primeira.itens[0].criadaEm == mais_novo["occurredAt"]
    assert proxima.itens[0].id == f"{mais_antigo['messageId']}:{usuario}"
