"""Verifica pré-condições da demo; não cria dados nem modifica serviços."""

import shutil
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def main():
    raiz = Path(__file__).resolve().parents[2]
    faltas = []
    for comando in ("docker", "curl"):
        if not shutil.which(comando):
            faltas.append(f"ferramenta indisponível: {comando}")
    for arquivo in (
        ".env", "scripts/seed.py", "scripts/demo/reset.sh",
        "scripts/demo/01-caminho-feliz.sh", "scripts/demo/02-perfil-incompleto.sh",
        "scripts/demo/03-expiracao.sh", "scripts/demo/04-identidade-fora.sh",
        "scripts/demo/05-concorrencia.sh", "apps/mobile/package.json", "bff/mobile/package.json",
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
            with urlopen("http://localhost:8000" + caminho, timeout=10) as resposta:
                status = resposta.status
        except HTTPError as erro:
            status = erro.code
        except URLError:
            faltas.append("gateway indisponível em localhost:8000")
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
