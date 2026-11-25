"""Seed de demonstração de Animais, pela API de escrita do próprio serviço.

Roda dentro do container (ou pod) do Animais, que já tem pymongo e PyJWT. Recebe a chave
privada do JWT em JWT_PRIVATE_KEY só durante a execução, para assinar o token de uma ONG.

1. registra a ONG como responsável verificada na réplica `responsaveis` (o que o evento
   `conta.verificada` da Identidade faria);
2. cadastra cada animal com POST /v1/animais, que grava o animal e o evento no outbox;
3. o relay publica no RabbitMQ e o projetor atualiza o modelo de leitura (CQRS), que a
   busca pública do gateway consulta.

Rodar de novo não duplica: animais que a ONG já tem com o mesmo nome são pulados.
"""

import json
import os
import time
import urllib.request

import jwt
from pymongo import MongoClient

BASE = "http://localhost:8001/v1/animais"
ONG_ID = "00000000-0000-4000-8000-0000000000a1"
ONG_NOME = "ONG Patinhas de Lavras"

ENDERECO = {
    "rua": "Rua Doutor Francisco Sales",
    "numero": "100",
    "bairro": "Centro",
    "cidade": "Lavras",
    "uf": "MG",
    "cep": "37200-000",
}

ANIMAIS = [
    ("Paçoca", "CAO", "MEDIO", "FEMEA", 24, ["dócil", "brincalhona"], -21.2449, -45.0003),
    ("Thor", "CAO", "GRANDE", "MACHO", 48, ["protetor", "calmo"], -21.2390, -44.9960),
    ("Mel", "GATO", "PEQUENO", "FEMEA", 8, ["curiosa"], -21.2510, -45.0050),
    ("Biscoito", "CAO", "PEQUENO", "MACHO", 6, ["filhote", "agitado"], -21.2300, -44.9900),
    ("Luna", "GATO", "PEQUENO", "FEMEA", 36, ["independente"], -21.2470, -44.9850),
    ("Bolt", "CAO", "MEDIO", "MACHO", 18, ["energético", "sociável"], -21.2600, -45.0100),
    ("Nina", "CAO", "PEQUENO", "FEMEA", 120, ["idosa", "carinhosa"], -21.2420, -45.0080),
    ("Frajola", "GATO", "MEDIO", "MACHO", 60, ["tranquilo"], -21.2350, -45.0150),
]


def token() -> str:
    chave = os.environ["JWT_PRIVATE_KEY"].replace("\\n", "\n")
    agora = int(time.time())
    reivindicacoes = {
        "iss": "ampara-identidade",
        "sub": ONG_ID,
        "role": "ONG",
        "email": "contato@patinhas.example",
        "iat": agora,
        "exp": agora + 900,
    }
    return jwt.encode(reivindicacoes, chave, algorithm="RS256")


def chamar(metodo: str, url: str, autorizacao: str, corpo: dict | None = None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Authorization", f"Bearer {autorizacao}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"null")


def main() -> None:
    cliente = MongoClient(os.environ["ANIMAIS_MONGO_URL"])
    banco = cliente.get_default_database()
    banco.responsaveis.update_one(
        {"_id": ONG_ID},
        {"$set": {"id": ONG_ID, "nome": ONG_NOME, "verificado": True}},
        upsert=True,
    )

    autorizacao = token()
    existentes = chamar("GET", BASE, autorizacao)
    itens = existentes.get("itens", existentes) if isinstance(existentes, dict) else existentes
    nomes = {a["nome"] for a in itens or []}

    criados = 0
    for nome, especie, porte, sexo, idade, temperamento, lat, lng in ANIMAIS:
        if nome in nomes:
            continue
        chamar(
            "POST",
            BASE,
            autorizacao,
            {
                "nome": nome,
                "especie": especie,
                "porte": porte,
                "sexo": sexo,
                "idadeMeses": idade,
                "temperamento": temperamento,
                "descricao": f"{nome} está sob os cuidados da {ONG_NOME}.",
                "localizacao": {"type": "Point", "coordinates": [lng, lat]},
                "endereco": ENDERECO,
            },
        )
        criados += 1
    print(f"seed: {criados} animais criados, {len(nomes)} já existiam")


if __name__ == "__main__":
    main()
