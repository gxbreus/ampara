"""Reconexão do consumidor quando o RabbitMQ cai (ex.: reinício do broker).

Regressão: com `connect_robust`, o `fila.iterator()` não era restaurado na reconexão e o
consumidor ficava parado para sempre, sem erro. Agora a queda encerra o iterador e o laço
abre uma conexão nova. Aqui a conexão é simulada; o teste com broker real que reinicia no
meio está descrito no PR.
"""

import asyncio
import json

import pytest

import app.consumidor as modulo
from app.consumidor import Consumidor


class Mensagem:
    def __init__(self, corpo):
        self.body = json.dumps(corpo).encode()
        self.resultado = None

    async def ack(self):
        self.resultado = "ack"

    async def nack(self, requeue):
        self.resultado = f"nack requeue={requeue}"

    async def reject(self, requeue):
        self.resultado = f"reject requeue={requeue}"


class Iterador:
    """Entrega as mensagens e depois termina (ou falha), como quando o canal fecha."""

    def __init__(self, mensagens, erro_no_fim):
        self.mensagens, self.erro_no_fim = list(mensagens), erro_no_fim

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.mensagens:
            return self.mensagens.pop(0)
        if self.erro_no_fim:
            raise ConnectionResetError(104, "Connection reset by peer")
        raise StopAsyncIteration


class Conexao:
    def __init__(self, iterador):
        self.iterador = iterador

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def channel(self, **_):
        conexao = self

        class Canal:
            async def set_qos(self, **_):
                pass

            async def get_queue(self, nome, ensure):
                class Fila:
                    def iterator(self):
                        return conexao.iterador

                return Fila()

        return Canal()


@pytest.mark.parametrize(
    "erro_no_fim", [True, False], ids=["queda com erro", "canal fechado sem erro"]
)
async def test_reconecta_e_volta_a_consumir_depois_de_uma_queda(monkeypatch, erro_no_fim):
    primeira, segunda = Mensagem({"version": 1, "n": 1}), Mensagem({"version": 1, "n": 2})
    conexoes = [Conexao(Iterador([primeira], erro_no_fim)), Conexao(Iterador([segunda], False))]
    chamadas = []

    async def connect(url, **kwargs):
        chamadas.append(kwargs)
        if conexoes:
            return conexoes.pop(0)
        await asyncio.Event().wait()  # depois da 2ª conexão, fica "conectado" para sempre

    monkeypatch.setattr(modulo.aio_pika, "connect", connect)
    monkeypatch.setattr(modulo, "ESPERA_RECONEXAO_S", 0)

    recebidas = []

    async def tratar(evento, canal):
        recebidas.append(evento["n"])

    consumidor = Consumidor("amqp://teste", "animais.comandos", tratar)
    consumidor.iniciar()
    for _ in range(100):
        if recebidas == [1, 2]:
            break
        await asyncio.sleep(0.01)
    await consumidor.parar()

    assert recebidas == [1, 2], "a mensagem publicada depois da queda não foi consumida"
    assert len(chamadas) >= 2, "o consumidor não abriu uma conexão nova"
    assert all(c.get("heartbeat") == modulo.HEARTBEAT_S for c in chamadas)
    assert primeira.resultado == "ack" and segunda.resultado == "ack"


def test_nao_usa_connect_robust():
    # connect_robust esconde a queda do iterador; a reconexão é responsabilidade deste laço
    import inspect

    assert "connect_robust" not in inspect.getsource(modulo.Consumidor.executar)
