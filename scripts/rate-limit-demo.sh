#!/usr/bin/env bash
# Eleva e restaura o rate limit de /mobile/v1 no cluster, em volta da demonstração de
# escala (docs/escalabilidade.md, "Antes de medir"). O hey manda dezenas de milhares de
# requisições em 20 s, e com os 600/min normais quase todas voltariam 429.
#   ./scripts/rate-limit-demo.sh elevar
#   ./scripts/rate-limit-demo.sh restaurar
set -euo pipefail

case "${1:-}" in
  elevar) limite=1000000 ;;
  restaurar) limite=600 ;;
  *) echo "uso: $0 elevar|restaurar" >&2; exit 2 ;;
esac

kubectl patch kongplugin rate-limit-mobile -n ampara --type merge -p "{\"config\":{\"minute\":$limite}}"
echo "rate limit de /mobile/v1: $limite/min"
