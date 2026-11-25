"""Verifica pré-condições da demo; não cria dados nem modifica serviços.

Uso: python3 scripts/demo/preflight.py [porta]   (padrão 8000; 8080 no Codespace)
"""

import shutil
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main():
    raiz = Path(__file__).resolve().parents[2]
    gateway = f"http://localhost:{sys.argv[1] if len(sys.argv) > 1 else 8000}"
    faltas = []
    for comando in ("docker", "curl"):
        if not shutil.which(comando):
            faltas.append(f"ferramenta indisponível: {comando}")
    for arquivo in (
        ".env", "scripts/seed.sh", "scripts/teste-rotas.sh",
        "apps/web/package.json", "apps/mobile/package.json", "bff/mobile/package.json",
    ):
        if not (raiz / arquivo).is_file():
            faltas.append(f"arquivo ausente: {arquivo}")
    if faltas:
        print("Demo ainda não está pronta:\n- " + "\n- ".join(faltas))
        return 2
    for caminho, esperado in (
        ("/mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10", 200),
        ("/mobile/v1/solicitacoes", 401),
    ):
        try:
            with urlopen(gateway + caminho, timeout=10) as resposta:
                status = resposta.status
        except HTTPError as erro:
            status = erro.code
        except URLError:
            faltas.append(f"gateway indisponível em {gateway}")
            break
        if status != esperado:
            faltas.append(f"{caminho}: HTTP {status}, esperado {esperado}")
    if faltas:
        print("Demo reprovada:\n- " + "\n- ".join(faltas))
        return 2
    print("Arquivos e rotas básicas disponíveis. Verifique seed, perfis, LLM e aparelho no roteiro.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
