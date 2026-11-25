#!/usr/bin/env bash
# Popula o sistema com dados de demonstração (uma ONG e oito animais em Lavras, MG).
#   ./scripts/seed.sh            # no docker compose
#   ./scripts/seed.sh k8s        # no cluster kind (namespace ampara)
# A chave privada do JWT sai do .env e só existe dentro do processo do seed.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
cd "$raiz"
chave="$(grep '^JWT_PRIVATE_KEY=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')"
[ -n "$chave" ] || { echo "JWT_PRIVATE_KEY vazia no .env" >&2; exit 1; }

case "${1:-compose}" in
  compose) docker compose exec -T -e JWT_PRIVATE_KEY="$chave" animais python - < scripts/seed/seed_animais.py ;;
  k8s) kubectl exec -i -n ampara deploy/animais -- env JWT_PRIVATE_KEY="$chave" python - < scripts/seed/seed_animais.py ;;
  *) echo "uso: $0 [compose|k8s]" >&2; exit 2 ;;
esac
