#!/usr/bin/env bash
# Opera as DLQs do RabbitMQ (#86). Lê o usuário admin do .env da raiz.
#   ./scripts/dlq.sh listar adocao.respostas.dlq
#   ./scripts/dlq.sh reprocessar adocao.respostas.dlq <messageId>
#   ./scripts/dlq.sh descartar adocao.respostas.dlq <messageId>
# RABBITMQ_API muda o endereço do painel (padrão http://localhost:15672). No Kubernetes:
#   kubectl -n ampara port-forward svc/rabbitmq 15672 &
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$raiz/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$raiz/.env"
  set +a
fi
exec python3 "$raiz/scripts/dlq.py" "$@"
