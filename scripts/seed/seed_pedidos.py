"""Seed de demonstração dos pedidos de adoção, pela API real da Adoção (a SAGA de verdade).

Roda dentro do container (ou pod) do Animais, que tem PyJWT e enxerga a Adoção pela rede
interna (ADOCAO_URL, padrão http://adocao:8080). Recebe a chave privada do JWT em
JWT_PRIVATE_KEY só durante a execução, para assinar os tokens dos adotantes e dos
responsáveis. Depende dos dois outros seeds: as contas (seed_identidade.js) e os animais
(seed_animais.py).

Deixa o painel das ONGs com estados variados, cada pedido feito por um adotante diferente
(a Identidade só deixa um adotante ter uma solicitação ativa por vez):

  Carlos  -> Thor   (ONG Patinhas)     AGUARDANDO_APROVACAO, para aprovar ou recusar ao vivo
  Ana     -> Luna   (ONG Patinhas)     AGUARDANDO_APROVACAO
  Marcos  -> Sol    (Abrigo Amigo Fiel) AGUARDANDO_APROVACAO
  Juliana -> Caramelo (ONG Patinhas)   aprovado -> CONCLUIDA (Caramelo vira ADOTADO)
  Pedro   -> Frajola  (ONG Patinhas)   recusado -> RECUSADA (Frajola volta a DISPONIVEL)
  Lucas   -> Paçoca   (ONG Patinhas)   perfil incompleto -> PERFIL_INVALIDO

A adotante principal (adotante@ampara.dev) fica de fora, para pedir um animal ao vivo.

Rodar de novo não duplica: se o adotante já tem uma solicitação para aquele animal, ela é
reaproveitada (e só avança, se tiver parado antes da decisão); a criação usa uma
Idempotency-Key determinística (adotante + animal).
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt

ANIMAIS = "http://localhost:8001/v1/animais"
ADOCAO = os.environ.get("ADOCAO_URL", "http://adocao:8080").rstrip("/") + "/v1/solicitacoes"

ONG = "00000000-0000-4000-8000-0000000000a1"
ONG2 = "00000000-0000-4000-8000-0000000000a2"
ROLE_RESPONSAVEL = {ONG: "ONG", ONG2: "ONG"}

CARLOS = "00000000-0000-4000-8000-0000000000e1"
ANA = "00000000-0000-4000-8000-0000000000e2"
JULIANA = "00000000-0000-4000-8000-0000000000e3"
PEDRO = "00000000-0000-4000-8000-0000000000e4"
LUCAS = "00000000-0000-4000-8000-0000000000e5"
MARCOS = "00000000-0000-4000-8000-0000000000e6"

# (adotante, nome do adotante, animal, responsável, estado final desejado, motivo da recusa)
PEDIDOS = [
    (JULIANA, "Juliana", "Caramelo", ONG, "CONCLUIDA", None),
    (PEDRO, "Pedro", "Frajola", ONG, "RECUSADA",
     "O Frajola precisa de uma casa com mais tempo de companhia: o perfil informa 10 horas fora por dia."),
    (LUCAS, "Lucas", "Paçoca", ONG, "PERFIL_INVALIDO", None),
    (CARLOS, "Carlos", "Thor", ONG, "AGUARDANDO_APROVACAO", None),
    (ANA, "Ana", "Luna", ONG, "AGUARDANDO_APROVACAO", None),
    (MARCOS, "Marcos", "Sol", ONG2, "AGUARDANDO_APROVACAO", None),
]

TERMINAIS = {"CONCLUIDA", "REJEITADA_INDISPONIVEL", "PERFIL_INVALIDO", "RECUSADA", "CANCELADA", "EXPIRADA", "FALHOU"}
ESPERA_SEGUNDOS = 90


def token(conta_id: str, role: str) -> str:
    chave = os.environ["JWT_PRIVATE_KEY"].replace("\\n", "\n")
    agora = int(time.time())
    reivindicacoes = {"iss": "ampara-identidade", "sub": conta_id, "role": role, "iat": agora, "exp": agora + 900}
    return jwt.encode(reivindicacoes, chave, algorithm="RS256")


def chamar(metodo: str, url: str, autorizacao: str, corpo: dict | None = None, cabecalhos: dict | None = None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", f"Bearer {autorizacao}")
    req.add_header("Content-Type", "application/json")
    for nome, valor in (cabecalhos or {}).items():
        req.add_header(nome, valor)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as erro:
        detalhe = erro.read().decode(errors="replace")[:300]
        raise RuntimeError(f"{metodo} {url}: HTTP {erro.code} {detalhe}") from erro


def animal_por_nome(responsavel: str, nome: str) -> dict:
    autorizacao = token(responsavel, ROLE_RESPONSAVEL[responsavel])
    cursor = None
    while True:
        url = f"{ANIMAIS}?limite=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        pagina = chamar("GET", url, autorizacao)
        for animal in pagina.get("itens", []):
            if animal["nome"] == nome:
                return animal
        cursor = pagina.get("proximoCursor")
        if not cursor:
            raise RuntimeError(f"animal {nome} não encontrado: rode antes o seed de Animais")


def esperar(solicitacao_id: str, autorizacao: str, ate: set[str]) -> dict:
    """Consulta a solicitação até ela chegar num dos estados pedidos ou num estado final."""
    limite = time.monotonic() + ESPERA_SEGUNDOS
    while True:
        s = chamar("GET", f"{ADOCAO}/{solicitacao_id}", autorizacao)
        if s["estado"] in ate or s["estado"] in TERMINAIS or time.monotonic() > limite:
            return s
        time.sleep(1)


def main() -> None:
    resumo = []
    for adotante, quem, nome_animal, responsavel, alvo, motivo in PEDIDOS:
        animal = animal_por_nome(responsavel, nome_animal)
        tok_adotante = token(adotante, "ADOTANTE")
        tok_responsavel = token(responsavel, ROLE_RESPONSAVEL[responsavel])

        filtro = urllib.parse.urlencode({"adotanteId": adotante, "animalId": animal["id"], "limite": 100})
        anteriores = chamar("GET", f"{ADOCAO}?{filtro}", tok_adotante)["_embedded"]["solicitacoes"]
        if anteriores:
            # a mais recente; uma que ainda não chegou ao fim é a que interessa
            s = sorted(anteriores, key=lambda x: x["criadoEm"])[-1]
            origem = "já existia"
        else:
            if animal["status"] != "DISPONIVEL":
                resumo.append(f"{quem} -> {nome_animal}: pulado, o animal está {animal['status']}")
                continue
            s = chamar(
                "POST", ADOCAO, tok_adotante, {"animalId": animal["id"]},
                {"Idempotency-Key": f"seed-demo-{adotante}-{animal['id']}"},
            )
            origem = "criada"

        s = esperar(s["id"], tok_adotante, {"AGUARDANDO_APROVACAO"})
        if s["estado"] == "AGUARDANDO_APROVACAO" and not s.get("decisao"):
            if alvo == "CONCLUIDA":
                chamar("POST", f"{ADOCAO}/{s['id']}/aprovacao", tok_responsavel)
            elif alvo == "RECUSADA":
                chamar("POST", f"{ADOCAO}/{s['id']}/recusa", tok_responsavel, {"motivo": motivo})
        if alvo != "AGUARDANDO_APROVACAO":
            s = esperar(s["id"], tok_adotante, {alvo})

        aviso = "" if s["estado"] == alvo else f" (esperado {alvo})"
        resumo.append(f"{quem} -> {nome_animal}: {s['estado']}{aviso} [{origem}, {s['id']}]")

    print("seed pedidos:")
    for linha in resumo:
        print(f"  {linha}")


if __name__ == "__main__":
    main()
