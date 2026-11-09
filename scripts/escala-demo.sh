#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://localhost:8000}"
url="${URL:-$base_url/mobile/v1/animais?lat=-21.24&lng=-45.00&raioKm=10}"
namespace="${NAMESPACE:-ampara}"

case "$url" in
  http://localhost:8000/*|http://127.0.0.1:8000/*) ;;
  *) echo "A demonstração deve entrar pelo Ingress em localhost:8000, não por um pod." >&2; exit 2 ;;
esac

command -v kubectl >/dev/null || { echo "kubectl não encontrado" >&2; exit 2; }
command -v hey >/dev/null || { echo "hey não encontrado: instale-o antes da demonstração" >&2; exit 2; }

if [[ "${DEMO_RATE_LIMIT_ELEVATED:-}" != "true" ]]; then
  echo "Defina DEMO_RATE_LIMIT_ELEVATED=true somente depois de aplicar o overlay temporário do rate limit." >&2
  exit 2
fi

contar_por_pod() {
  local arquivo
  arquivo="$(mktemp)"
  trap 'rm -f "$arquivo"' RETURN
  for _ in $(seq 300); do
    curl --silent --show-error --output /dev/null --dump-header - "$url" \
      | awk 'BEGIN{IGNORECASE=1} /^x-animais-served-by:/ {print $2}' \
      | tr -d '\r' >> "$arquivo"
  done
  if [[ ! -s "$arquivo" ]]; then
    echo "O BFF Mobile não devolveu X-Animais-Served-By; interrompendo a demonstração." >&2
    return 1
  fi
  sort "$arquivo" | uniq -c
}

medir() {
  local replicas="$1"
  echo "== ${replicas} réplica(s) =="
  kubectl scale deployment/animais --namespace "$namespace" --replicas="$replicas"
  kubectl rollout status deployment/animais --namespace "$namespace" --timeout=90s
  kubectl get pods --namespace "$namespace" --selector app=animais -o wide
  echo "Distribuição de 300 requisições:"
  contar_por_pod
  echo "Carga (20 s, concorrência 20):"
  hey -z 20s -c 20 "$url" | grep -E 'Requests/sec|50%|95%|\[2[0-9][0-9]\]|\[4[0-9][0-9]\]|\[5[0-9][0-9]\]'
}

medir 1
medir 3
