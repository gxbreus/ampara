"""Participantes falsos da SAGA: fazem o papel de Animais e da Identidade enquanto os
serviços de verdade (#54 e #57) não existem. Consomem os comandos com os usuários do
RabbitMQ de cada serviço e respondem como o catálogo define (docs/contratos/eventos.md).

Imitam as garantias que os participantes reais precisam ter:
- inbox por messageId: o mesmo comando reentregue recebe a MESMA resposta;
- sagas_compensadas: uma ação que chega depois da compensação é recusada com SAGA_ENCERRADA.

Variáveis de ambiente:
  AMQP_HOST                 rabbitmq
  ANIMAIS_SENHA, IDENTIDADE_SENHA
  ATRASO_S=0                espera antes de cada resposta (para derrubar a Adoção no meio)
  PERFIL=completo           completo | incompleto  (resposta do ValidarPerfil)
  ANIMAL=disponivel         disponivel | reservado (resposta do ReservarAnimal)
  IDENTIDADE=no-ar          no-ar | fora           (fora: não consome identidade.comandos)
"""
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone

import pika

HOST = os.environ.get("AMQP_HOST", "rabbitmq")
ATRASO = float(os.environ.get("ATRASO_S", "0"))
PERFIL = os.environ.get("PERFIL", "completo")
ANIMAL = os.environ.get("ANIMAL", "disponivel")
IDENTIDADE = os.environ.get("IDENTIDADE", "no-ar")


def agora():
    return datetime.now(timezone.utc).isoformat()


def responder(tipo, payload, comando):
    return {
        "messageId": str(uuid.uuid4()),
        "type": tipo,
        "version": 1,
        "correlationId": comando.get("correlationId", ""),
        "sagaId": comando["sagaId"],
        "occurredAt": agora(),
        "payload": payload,
    }


class Participante:
    def __init__(self, usuario, senha, fila):
        self.usuario, self.senha, self.fila = usuario, senha, fila
        self.inbox = {}               # messageId do comando -> resposta já enviada
        self.compensadas = set()      # sagaId com compensação aplicada

    def tratar(self, cmd):
        raise NotImplementedError

    def rodar(self):
        while True:
            try:
                cred = pika.PlainCredentials(self.usuario, self.senha)
                conn = pika.BlockingConnection(pika.ConnectionParameters(HOST, credentials=cred, heartbeat=30))
                canal = conn.channel()
                canal.confirm_delivery()
                canal.basic_qos(prefetch_count=1)
                print(f"[{self.usuario}] consumindo {self.fila}", flush=True)
                for metodo, props, corpo in canal.consume(self.fila):
                    cmd = json.loads(corpo)
                    resposta = self.inbox.get(cmd["messageId"])
                    if resposta is None:
                        if ATRASO:
                            time.sleep(ATRASO)
                        resposta = self.tratar(cmd)
                        self.inbox[cmd["messageId"]] = resposta
                    else:
                        print(f"[{self.usuario}] {cmd['type']} repetido: mesma resposta", flush=True)
                    canal.basic_publish("ampara.respostas", "adocao", json.dumps(resposta),
                                        pika.BasicProperties(content_type="application/json", delivery_mode=2,
                                                             message_id=resposta["messageId"], type=resposta["type"],
                                                             correlation_id=resposta["correlationId"]))
                    canal.basic_ack(metodo.delivery_tag)  # ack só depois de publicar a resposta
                    print(f"[{self.usuario}] {cmd['type']} -> {resposta['type']} {resposta['payload']}", flush=True)
            except pika.exceptions.AMQPError as e:
                print(f"[{self.usuario}] conexão caiu ({e!r}); tentando de novo", flush=True)
                time.sleep(2)


class Animais(Participante):
    def __init__(self):
        super().__init__("animais", os.environ["ANIMAIS_SENHA"], "animais.comandos")
        self.reservas = {}  # animalId -> sagaId

    def tratar(self, cmd):
        saga, animal = cmd["sagaId"], cmd["payload"]["animalId"]
        if cmd["type"] == "ReservarAnimal":
            if saga in self.compensadas:
                return responder("ReservaRecusada", {"animalId": animal, "motivo": "SAGA_ENCERRADA"}, cmd)
            if ANIMAL == "reservado" or self.reservas.get(animal) not in (None, saga):
                return responder("ReservaRecusada", {"animalId": animal, "motivo": "INDISPONIVEL"}, cmd)
            self.reservas[animal] = saga
            return responder("AnimalReservado", {"animalId": animal, "responsavelId": "c50a83ab-7db0-41b4-9436-4144c36f97d5",
                                                 "animalNome": "Thor"}, cmd)
        if cmd["type"] == "LiberarReserva":
            self.compensadas.add(saga)
            liberou = self.reservas.get(animal) == saga
            if liberou:
                del self.reservas[animal]
            return responder("ReservaLiberada", {"animalId": animal, "liberou": liberou}, cmd)
        if cmd["type"] == "ConfirmarAdocao":
            if self.reservas.get(animal) != saga:
                return responder("ConfirmacaoRecusada", {"animalId": animal, "motivo": "NAO_RESERVADO"}, cmd)
            return responder("AdocaoConfirmada", {"animalId": animal}, cmd)
        raise ValueError(cmd["type"])


class Identidade(Participante):
    def __init__(self):
        super().__init__("identidade", os.environ["IDENTIDADE_SENHA"], "identidade.comandos")
        self.vagas = {}  # adotanteId -> sagaId

    def tratar(self, cmd):
        saga, adotante = cmd["sagaId"], cmd["payload"]["adotanteId"]
        if cmd["type"] == "ValidarPerfil":
            if saga in self.compensadas:
                return responder("PerfilRecusado", {"adotanteId": adotante, "motivo": "SAGA_ENCERRADA"}, cmd)
            if PERFIL == "incompleto":
                return responder("PerfilRecusado", {"adotanteId": adotante, "motivo": "PERFIL_INCOMPLETO",
                                                    "camposFaltando": ["aceiteTermo"]}, cmd)
            if self.vagas.get(adotante) not in (None, saga):
                return responder("PerfilRecusado", {"adotanteId": adotante, "motivo": "LIMITE_SOLICITACOES"}, cmd)
            self.vagas[adotante] = saga
            return responder("PerfilValidado", {"adotanteId": adotante}, cmd)
        if cmd["type"] == "LiberarVaga":
            self.compensadas.add(saga)
            liberou = self.vagas.get(adotante) == saga
            if liberou:
                del self.vagas[adotante]
            return responder("VagaLiberada", {"adotanteId": adotante, "liberou": liberou}, cmd)
        if cmd["type"] == "RegistrarAdocao":
            self.vagas.pop(adotante, None)
            return responder("AdocaoRegistrada", {"adotanteId": adotante, "animalId": cmd["payload"]["animalId"]}, cmd)
        raise ValueError(cmd["type"])


if __name__ == "__main__":
    participantes = [Animais()] + ([Identidade()] if IDENTIDADE == "no-ar" else [])
    for p in participantes:
        threading.Thread(target=p.rodar, daemon=True).start()
    threading.Event().wait()
