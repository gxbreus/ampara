"""Coleta as evidências reais da #166 pelo Kong e restaura Animais após a falha.

Use apenas no Compose de demonstração: pausa Animais por alguns segundos.
Não precisa de token e não lê ou imprime credenciais.
"""

import json
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


RAIZ = Path(__file__).resolve().parents[1]
PASTA = RAIZ / "docs/execucao/medicoes"
BUSCA = "http://localhost:8000/mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10"


def comando(*args):
    return subprocess.run(args, cwd=RAIZ, check=True, capture_output=True, text=True).stdout


def consultar(url):
    inicio = time.perf_counter()
    saida = comando("curl.exe" if __import__("os").name == "nt" else "curl",
                    "--silent", "--show-error", "--max-time", "10", "-i", url)
    duracao = (time.perf_counter() - inicio) * 1000
    cabecalhos, corpo = saida.split("\n\n", 1)
    status = int(cabecalhos.splitlines()[0].split()[1])
    headers = dict(linha.split(": ", 1) for linha in cabecalhos.splitlines()[1:] if ": " in linha)
    return {"status": status, "duracao_ms": duracao, "headers": headers,
            "corpo": json.loads(corpo), "curl_i": saida}


def main():
    resultado = {"data": datetime.now(timezone(timedelta(hours=-3))).isoformat()}
    resultado["busca_anonima"] = consultar(BUSCA)
    assert resultado["busca_anonima"]["status"] == 200
    headers = {k.lower(): v for k, v in resultado["busca_anonima"]["headers"].items()}
    assert headers.get("x-served-by") and headers.get("x-animais-served-by")
    resultado["health_sem_token"] = consultar("http://localhost:8000/mobile/v1/health")
    assert resultado["health_sem_token"]["status"] == 401
    pausado = False
    try:
        comando("docker", "compose", "pause", "animais")
        pausado = True
        resultado["animais_pausado"] = consultar(BUSCA)
        assert resultado["animais_pausado"]["status"] == 504
        assert resultado["animais_pausado"]["duracao_ms"] <= 3500
        assert resultado["animais_pausado"]["corpo"]["codigo"] == "servico-lento"
    finally:
        if pausado:
            comando("docker", "compose", "unpause", "animais")
    resultado["busca_apos_restauracao"] = consultar(BUSCA)
    assert resultado["busca_apos_restauracao"]["status"] == 200
    resultado["imagens"] = []
    for imagem in ("ampara/bff-mobile:dev", "ampara/bff-mobile:medicao-build"):
        dados = json.loads(comando("docker", "image", "inspect", imagem))[0]
        resultado["imagens"].append({"tag": imagem, "id": dados["Id"], "bytes": dados["Size"]})
    resultado["git_head"] = comando("git", "rev-parse", "HEAD").strip()
    PASTA.mkdir(parents=True, exist_ok=True)
    destino = PASTA / "bff-mobile-2026-11-25.json"
    destino.write_text(json.dumps(resultado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"arquivo": str(destino.relative_to(RAIZ)),
                      "busca": resultado["busca_anonima"]["status"],
                      "health": resultado["health_sem_token"]["status"],
                      "falha": resultado["animais_pausado"]["status"],
                      "timeout_ms": resultado["animais_pausado"]["duracao_ms"]}))


if __name__ == "__main__":
    main()
