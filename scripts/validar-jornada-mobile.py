"""Ensaia login, perfil, ficha, pedido, histórico e cancelamento no gateway real.

Requer scripts/seed.sh executado no Compose de demonstração. Não imprime tokens
ou senhas. Cria e cancela uma solicitação real para Thor.
"""

import json
import time
import urllib.request
from pathlib import Path
from uuid import uuid4


RAIZ = Path(__file__).resolve().parents[1]


def main():
    env = {}
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if linha and not linha.startswith("#") and "=" in linha:
            nome, valor = linha.split("=", 1)
            env[nome] = json.loads(valor) if valor.startswith('"') else valor
    registros = []

    def chamar(metodo, caminho, token=None, corpo=None, chave=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if chave:
            headers["Idempotency-Key"] = chave
        req = urllib.request.Request("http://localhost:8000" + caminho, method=metodo,
                                     data=json.dumps(corpo).encode() if corpo is not None else None,
                                     headers=headers)
        with urllib.request.urlopen(req, timeout=25) as r:
            dados = json.load(r)
            registros.append({"metodo": metodo, "caminho": caminho, "status": r.status})
            return dados

    def login(email):
        return chamar("POST", "/auth/v1/sessoes", corpo={"email": email, "senha": env["SEED_SENHA_DEMO"]})["accessToken"]

    ong = login("ong@ampara.dev")
    adotante = login("adotante@ampara.dev")
    conta = chamar("GET", "/mobile/v1/eu", adotante)
    perfil = chamar("GET", "/mobile/v1/eu/perfil-adocao", adotante)
    assert perfil["completo"]
    corpo = {k: perfil[k] for k in ("tipoMoradia", "temQuintal", "outrosAnimais", "horasForaDeCasa", "aceiteTermo")}
    assert chamar("PUT", "/mobile/v1/eu/perfil-adocao", adotante, corpo)["completo"]
    animais = chamar("GET", "/web/v1/animais", ong)
    thor = next(a for a in animais["itens"] if a["nome"] == "Thor")
    animal_id = thor["id"]
    ficha = chamar("GET", f"/mobile/v1/animais/{animal_id}")
    assert ficha["nome"] == "Thor" and "endereco" not in ficha
    pedido = chamar("POST", "/mobile/v1/solicitacoes", adotante, {"animalId": animal_id}, str(uuid4()))
    base = f'/mobile/v1/solicitacoes/{pedido["id"]}'
    estados = []
    for _ in range(40):
        detalhe = chamar("GET", base, adotante)
        if not estados or estados[-1] != detalhe["estado"]:
            estados.append(detalhe["estado"])
        if detalhe["estado"] == "AGUARDANDO_APROVACAO":
            break
        if detalhe["estado"] in {"FALHOU", "CANCELADA", "PERFIL_INVALIDO"}:
            raise AssertionError(f"SAGA encerrou antes da aprovação: {estados}")
        time.sleep(0.5)
    assert detalhe["estado"] == "AGUARDANDO_APROVACAO", estados
    historico = chamar("GET", base + "/linha-do-tempo", adotante)
    assert historico["etapas"]
    lista = chamar("GET", "/mobile/v1/solicitacoes", adotante)
    assert any(s["id"] == pedido["id"] for s in lista["itens"])
    acao = detalhe["_links"]["cancelar"]
    chamar(acao.get("method", "POST"), acao["href"], adotante, {})
    for _ in range(40):
        detalhe = chamar("GET", base, adotante)
        if estados[-1] != detalhe["estado"]:
            estados.append(detalhe["estado"])
        if detalhe["estado"] == "CANCELADA":
            break
        time.sleep(0.5)
    assert detalhe["estado"] == "CANCELADA", estados
    assert "cancelar" not in detalhe["_links"]
    resultado = {"conta_id": conta["id"], "animal_id": animal_id, "pedido_id": pedido["id"],
                 "estados_observados": estados, "etapas_antes_cancelamento": historico["etapas"],
                 "chamadas": registros}
    pasta = RAIZ / "docs/execucao/medicoes"
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "jornada-mobile-2026-11-25.json").write_text(json.dumps(resultado, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"estados": estados, "chamadas": len(registros), "resultado": "OK"}))


if __name__ == "__main__":
    main()
