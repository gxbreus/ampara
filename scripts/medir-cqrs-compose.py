"""Executa as medições reais da #165 no Compose local sem expor tokens ou chaves.

O ambiente de demonstração precisa estar saudável. Cria 1.050 animais sintéticos
pela API de escrita. A única preparação direta no banco é a ONG verificada de teste.
"""

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / "docs/execucao/medicoes"


def executar(*args, **kwargs):
    return subprocess.run(args, cwd=RAIZ, capture_output=True, text=True, check=True, **kwargs)


def main():
    valores = {}
    for linha in (RAIZ / ".env").read_text(encoding="utf-8").splitlines():
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        valores[nome] = json.loads(valor) if valor.startswith('"') else valor
    executar("docker", "compose", "cp", "services/animais/scripts", "animais:/tmp/medicao-cqrs")
    # Dependência apenas da medição, instalada em /tmp, sem alterar a imagem final.
    executar("docker", "compose", "exec", "-T", "animais", "python", "-m", "pip", "install",
             "--quiet", "--target", "/tmp/medicao-deps", "httpx==0.28.1", timeout=180)
    codigo = r'''
import asyncio, contextlib, io, json, os, sys, time
from types import SimpleNamespace
import jwt
from pymongo import MongoClient
sys.path.insert(0, "/tmp/medicao-cqrs")
sys.path.insert(0, "/tmp/medicao-deps")
import medir_busca, medir_defasagem
ong = "00000000-0000-4000-8000-000000000165"
with MongoClient(os.environ["ANIMAIS_MONGO_URL"]) as mongo:
    mongo.get_default_database().responsaveis.update_one(
        {"_id": ong}, {"$set": {"id": ong, "nome": "ONG Medicao CQRS", "verificado": True}}, upsert=True)
agora = int(time.time())
os.environ["DEMO_TOKEN_RESPONSAVEL"] = jwt.encode(
    {"iss":"ampara-identidade", "sub":ong, "role":"ONG", "iat":agora, "exp":agora+3600},
    os.environ.pop("JWT_PRIVATE_KEY").replace("\\n", "\n"), algorithm="RS256")
args = SimpleNamespace(url="http://localhost:8001", entrada="/tmp/medicao-cqrs/entrada-medicao.json",
                       animais=1000, amostras=200, lat=-21.2468, lng=-44.9998)
resultado = {}
for nome, medir in [("busca", medir_busca.medir), ("defasagem", medir_defasagem.medir)]:
    saida = io.StringIO()
    with contextlib.redirect_stdout(saida):
        asyncio.run(medir(args))
    resultado[nome] = json.loads(saida.getvalue())
print(json.dumps(resultado))
'''
    env = {**os.environ, "JWT_PRIVATE_KEY": valores["JWT_PRIVATE_KEY"]}
    print("Criando 1.000 animais, medindo 200 buscas e 50 cadastros CQRS...", flush=True)
    medicao = executar(
        "docker", "compose", "exec", "-T", "-e", "JWT_PRIVATE_KEY", "animais", "python", "-",
        input=codigo, env=env, timeout=1200,
    )
    resultado = json.loads(medicao.stdout)
    resultado["ambiente"] = {
        "data": datetime.now(timezone(timedelta(hours=-3))).isoformat(),
        "transporte": "HTTP localhost dentro do container Animais; sem gateway/BFF",
        "docker": executar("docker", "version", "--format", "{{.Server.Version}}").stdout.strip(),
        "recursos_docker": executar("docker", "info", "--format", "{{.NCPU}} CPUs; {{.MemTotal}} bytes RAM; {{.OSType}}/{{.Architecture}}").stdout.strip(),
        "imagem_animais": executar("docker", "image", "inspect", "ampara/animais:dev", "--format", "{{.Id}}").stdout.strip(),
        "git_head": executar("git", "rev-parse", "HEAD").stdout.strip(),
        "checkout_com_alteracoes": bool(executar("git", "status", "--porcelain").stdout.strip()),
        "memoria_animais_bytes": int(executar("docker", "inspect", "ampara-animais-1", "--format", "{{.HostConfig.Memory}}").stdout),
        "memoria_mongo_bytes": int(executar("docker", "inspect", "ampara-mongo-animais-1", "--format", "{{.HostConfig.Memory}}").stdout),
        "replicas_por_servico": 1,
    }
    PASTA.mkdir(parents=True, exist_ok=True)
    destino = PASTA / "cqrs-2026-11-25.json"
    destino.write_text(json.dumps(resultado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"arquivo": str(destino.relative_to(RAIZ)),
                      "busca_p95_ms": resultado["busca"]["p95_ms"],
                      "defasagem_p95_ms": resultado["defasagem"]["p95_ms"]}))


if __name__ == "__main__":
    main()
