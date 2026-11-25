#!/usr/bin/env bash
# Popula o sistema com dados de demonstração:
# 1. Identidade: as contas da demo (ONG, protetor, admin e adotante com perfil completo);
# 2. Animais: a ONG como responsável verificada e oito animais em Lavras, MG.
#   ./scripts/seed.sh            # no docker compose
#   ./scripts/seed.sh k8s        # no cluster kind (namespace ampara)
# As contas usam ids fixos, os mesmos do seed de Animais e do login de desenvolvimento dos
# apps. A senha delas é SEED_SENHA_DEMO do .env. A chave privada do JWT e a senha saem do
# .env e só existem dentro do processo do seed.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
cd "$raiz"
ler() { grep "^$1=" .env | cut -d= -f2- | sed 's/^"//; s/"$//'; }
chave="$(ler JWT_PRIVATE_KEY)"
senha="$(ler SEED_SENHA_DEMO)"
[ -n "$chave" ] || { echo "JWT_PRIVATE_KEY vazia no .env" >&2; exit 1; }
[ "${#senha}" -ge 8 ] || { echo "defina SEED_SENHA_DEMO no .env (mínimo 8 caracteres): é a senha das contas da demo" >&2; exit 1; }
case "${1:-compose}" in
  compose)
    docker compose exec -T -e SEED_SENHA="$senha" identidade node - < scripts/seed/seed_identidade.js
    docker compose exec -T -e JWT_PRIVATE_KEY="$chave" animais python - < scripts/seed/seed_animais.py
    ;;
  k8s)
    kubectl exec -i -n ampara deploy/identidade -- env SEED_SENHA="$senha" node - < scripts/seed/seed_identidade.js
    kubectl exec -i -n ampara deploy/animais -- env JWT_PRIVATE_KEY="$chave" python - < scripts/seed/seed_animais.py
    ;;
  *) echo "uso: $0 [compose|k8s]" >&2; exit 2 ;;
esac
echo "contas da demo: ong@, protetor@, admin@ e adotante@ampara.dev, com a senha SEED_SENHA_DEMO do .env"
