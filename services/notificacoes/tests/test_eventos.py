import json
from unittest.mock import AsyncMock, Mock

import pytest
from redis.exceptions import ConnectionError

from app.consumidor import processar
from app.eventos import Evento, destinatarios


@pytest.mark.parametrize(
    ("tipo", "campos", "destinos", "texto"),
    [
        (
            "adocao.aguardando_aprovacao",
            {"expiraEm": "2026-11-20T15:00:00Z"},
            ["responsavelId", "adotanteId"],
            "Nova solicitação para Thor",
        ),
        ("adocao.aprovada", {}, ["adotanteId", "responsavelId"], "Thor foi aprovada"),
        ("adocao.concluida", {}, ["adotanteId", "responsavelId"], "Thor foi concluída"),
        ("adocao.recusada", {"motivo": "Mudança"}, ["adotanteId"], "Mudança"),
        ("adocao.cancelada", {}, ["adotanteId", "responsavelId"], "Thor foi cancelada"),
        ("adocao.expirada", {}, ["adotanteId"], "Thor expirou"),
        (
            "adocao.falhou",
            {
                "animalNome": None,
                "responsavelId": None,
                "estadoFinal": "REJEITADA_INDISPONIVEL",
                "motivo": "INDISPONIVEL",
            },
            ["adotanteId"],
            "o animal não está mais disponível",
        ),
    ],
)
def test_destinatarios_de_adocao(dados_evento, tipo, campos, destinos, texto):
    dados_evento["type"] = tipo
    dados_evento["payload"].update(campos)
    avisos = destinatarios(Evento.model_validate_json(json.dumps(dados_evento)))
    assert [str(aviso.usuario) for aviso in avisos] == [
        dados_evento["payload"][campo] for campo in destinos
    ]
    assert texto in avisos[0].texto
    assert avisos[0].link == f"/solicitacoes/{dados_evento['payload']['solicitacaoId']}"


@pytest.mark.parametrize("role", ["ONG", "PROTETOR"])
def test_conta_verificada(dados_evento, role):
    conta_id = dados_evento["payload"]["responsavelId"]
    dados_evento.update(
        type="conta.verificada",
        sagaId=None,
        payload={"contaId": conta_id, "role": role, "nome": "Patas", "cidade": "Lavras"},
    )
    (aviso,) = destinatarios(Evento.model_validate_json(json.dumps(dados_evento)))
    assert str(aviso.usuario) == conta_id
    assert "já pode cadastrar animais" in aviso.texto


@pytest.mark.parametrize("valido", [False, True])
async def test_consumidor_distingue_evento_invalido_de_redis_indisponivel(dados_evento, valido):
    if not valido:
        del dados_evento["payload"]["adotanteId"]
    mensagem = Mock(
        body=json.dumps(dados_evento).encode(),
        message_id=None,
        correlation_id=None,
        type=None,
        ack=AsyncMock(),
        nack=AsyncMock(),
    )
    caixa = Mock(gravar=AsyncMock(side_effect=ConnectionError()))

    await processar(mensagem, caixa=caixa)

    mensagem.nack.assert_awaited_once_with(requeue=valido)
    mensagem.ack.assert_not_awaited()
    assert caixa.gravar.await_count == int(valido)
