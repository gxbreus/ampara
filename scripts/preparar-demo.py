"""Cria um .env local com credenciais aleatórias e chaves JWT, sem sobrescrever."""

import argparse
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path


def openssl_disponivel():
    executavel = shutil.which("openssl")
    if executavel:
        return executavel
    candidato = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/usr/bin/openssl.exe"
    if candidato.is_file():
        return str(candidato)
    raise RuntimeError("Instale OpenSSL (no Windows, incluído no Git for Windows).")


def gerar(template: str) -> str:
    valores = dict(re.findall(r"^([A-Z][A-Z0-9_]*)=(.*)$", template, re.M))
    for nome in valores:
        if nome.endswith("_PASSWORD"):
            valores[nome] = secrets.token_hex(24)
    for nome, valor in {
        "IDENTIDADE_DB_USER": "identidade", "ANIMAIS_DB_USER": "animais",
        "ADOCAO_DB_USER": "adocao", "ORQUESTRADOR_DB_USER": "orquestrador",
        "RABBITMQ_ADMIN_USER": "admin",
    }.items():
        valores[nome] = valor
    executavel = openssl_disponivel()
    privada = subprocess.run(
        [executavel, "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
        capture_output=True, check=True,
    ).stdout
    publica = subprocess.run(
        [executavel, "pkey", "-pubout"], input=privada, capture_output=True, check=True,
    ).stdout
    for chave, pem in (("JWT_PRIVATE_KEY", privada), ("JWT_PUBLIC_KEY", publica)):
        valores[chave] = '"' + pem.decode().replace("\r\n", "\n").replace("\n", "\\n") + '"'
    valores.update({
        "IDENTIDADE_DATABASE_URL": f"postgresql://identidade:{valores['IDENTIDADE_DB_PASSWORD']}@postgres-identidade:5432/identidade",
        "ANIMAIS_MONGO_URL": f"mongodb://animais:{valores['ANIMAIS_DB_PASSWORD']}@mongo-animais:27017/animais?replicaSet=rs0&authSource=admin",
        "ANIMAIS_LEITURA_MONGO_URL": f"mongodb://animais:{valores['ANIMAIS_DB_PASSWORD']}@mongo-animais:27017/animais_leitura?replicaSet=rs0&authSource=admin",
        "NOTIFICACOES_REDIS_URL": f"redis://:{valores['NOTIFICACOES_REDIS_PASSWORD']}@redis-notificacoes:6379/0",
        "ASSISTENTE_REDIS_URL": f"redis://:{valores['ASSISTENTE_REDIS_PASSWORD']}@redis-assistente:6379/0",
    })
    for servico in ("ANIMAIS", "IDENTIDADE", "NOTIFICACOES"):
        valores[f"{servico}_AMQP_URL"] = (
            f"amqp://{servico.lower()}:{valores[f'RABBITMQ_{servico}_PASSWORD']}@rabbitmq:5672/"
        )
    linhas = []
    for linha in template.splitlines():
        nome, separador, _ = linha.partition("=")
        linhas.append(f"{nome}={valores[nome]}" if separador and nome in valores else linha)
    return "\n".join(linhas) + "\n"


def main():
    raiz = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=raiz / ".env")
    args = parser.parse_args()
    if args.output.exists():
        parser.exit(1, "Arquivo já existe. Mantido sem alteração; não há rotação automática de credenciais.\n")
    conteudo = gerar((raiz / ".env.example").read_text(encoding="utf-8"))
    # O_EXCL impede sobrescrita mesmo se outro processo criar o arquivo no intervalo.
    descritor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descritor, "w", encoding="utf-8", newline="\n") as arquivo:
        arquivo.write(conteudo)
    print("Configuração local criada. Credenciais não são exibidas. LLM_API_KEY continua opcional.")


if __name__ == "__main__":
    main()
