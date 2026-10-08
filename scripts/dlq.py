"""Opera as DLQs do RabbitMQ pela API HTTP do Management (#86). Use pelo scripts/dlq.sh.

  listar      <fila.dlq>              mostra as mensagens, sem tirá-las da DLQ
  reprocessar <fila.dlq> <messageId>  devolve a mensagem para a fila de origem (mesmo messageId)
  descartar   <fila.dlq> <messageId>  apaga a mensagem

A API não tira uma mensagem específica da fila. Para reprocessar ou descartar, o script
esvazia a DLQ, grava um backup local, trata a mensagem escolhida e republica as outras na
DLQ, na mesma ordem. Se algo falhar no meio, o backup tem tudo o que foi retirado.
"""
import base64
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("RABBITMQ_API", "http://localhost:15672").rstrip("/")
USUARIO = os.environ.get("RABBITMQ_ADMIN_USER", "")
SENHA = os.environ.get("RABBITMQ_ADMIN_PASSWORD", "")
VHOST = urllib.parse.quote("/", safe="")


def chamar(metodo, caminho, corpo=None):
    req = urllib.request.Request(API + caminho, method=metodo, data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Content-Type": "application/json"})
    cred = base64.b64encode(f"{USUARIO}:{SENHA}".encode()).decode()
    req.add_header("Authorization", "Basic " + cred)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        sys.exit(f"erro {e.code} em {caminho}: {e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"não consegui falar com {API}: {e.reason}")


def ler(fila, remover):
    modo = "ack_requeue_false" if remover else "ack_requeue_true"
    return chamar("POST", f"/api/queues/{VHOST}/{urllib.parse.quote(fila, safe='')}/get",
                  {"count": 10000, "ackmode": modo, "encoding": "auto"})


def resumo(m):
    p = m.get("properties", {})
    try:
        corpo = json.loads(m["payload"]) if m.get("payload_encoding") == "string" else {}
    except ValueError:
        corpo = {}
    morte = (p.get("headers") or {}).get("x-death", [{}])[0]
    return {
        "messageId": p.get("message_id") or corpo.get("messageId") or "(sem messageId)",
        "tipo": p.get("type") or corpo.get("type") or "?",
        "sagaId": corpo.get("sagaId", ""),
        "motivo": morte.get("reason", ""),
        "origem": morte.get("queue", ""),
        "mortes": morte.get("count", ""),
    }


def publicar(m, fila_destino):
    props = dict(m.get("properties", {}))
    resp = chamar("POST", f"/api/exchanges/{VHOST}/amq.default/publish", {
        "properties": props, "routing_key": fila_destino,
        "payload": m["payload"], "payload_encoding": m.get("payload_encoding", "string"),
    })
    if not resp or not resp.get("routed"):
        raise RuntimeError(f"a mensagem não chegou a {fila_destino}")


def listar(fila):
    msgs = ler(fila, remover=False)
    if not msgs:
        print(f"{fila}: vazia")
        return
    print(f"{fila}: {len(msgs)} mensagem(ns)")
    for m in msgs:
        r = resumo(m)
        print(f"  {r['messageId']}  {r['tipo']:<20} saga={r['sagaId'] or '-'}  motivo={r['motivo']}  origem={r['origem']}  mortes={r['mortes']}")


def tratar(fila, alvo, acao):
    if not any(resumo(m)["messageId"] == alvo for m in ler(fila, remover=False)):
        sys.exit(f"{alvo} não está em {fila}")
    msgs = ler(fila, remover=True)
    backup = os.path.join(tempfile.gettempdir(), f"dlq-{fila}-{int(time.time())}.json")
    with open(backup, "w") as f:
        json.dump(msgs, f)
    try:
        for m in msgs:
            r = resumo(m)
            if r["messageId"] != alvo:
                publicar(m, fila)                 # as outras voltam para a DLQ
            elif acao == "reprocessar":
                if not r["origem"]:
                    raise RuntimeError("a mensagem não tem x-death: não sei a fila de origem")
                publicar(m, r["origem"])
                print(f"{alvo} devolvida para {r['origem']} (mesmo messageId)")
            else:
                print(f"{alvo} descartada")
    except Exception as e:
        sys.exit(f"falhou no meio ({e}); as mensagens retiradas estão em {backup}")
    os.remove(backup)


if __name__ == "__main__":
    if not USUARIO or not SENHA:
        sys.exit("defina RABBITMQ_ADMIN_USER e RABBITMQ_ADMIN_PASSWORD (o dlq.sh lê do .env)")
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == "listar":
        listar(args[1])
    elif len(args) == 3 and args[0] in ("reprocessar", "descartar"):
        tratar(args[1], args[2], args[0])
    else:
        sys.exit(__doc__)
