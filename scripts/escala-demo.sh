#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://localhost:8000}"
url="${URL:-$base_url/mobile/v1/animais?lat=-21.24&lng=-45.00&raioKm=10}"
namespace="${NAMESPACE:-ampara}"
scripts_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

case "$url" in
  http://localhost:8000/*|http://127.0.0.1:8000/*) ;;
  *) echo "A demonstração deve entrar pelo Ingress em localhost:8000, não por um pod." >&2; exit 2 ;;
esac

command -v kubectl >/dev/null || { echo "kubectl não encontrado" >&2; exit 2; }
command -v hey >/dev/null || { echo "hey não encontrado: instale-o antes da demonstração" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl não encontrado" >&2; exit 2; }

if [[ "${1:-}" == "--rate-limit-test" ]]; then
  saida="$(mktemp)"
  trap 'rm -f -- "$saida"' EXIT
  echo "Teste separado de 429: mantenha o rate limit normal (600/min)."
  hey -n 1200 -c 20 "$url" > "$saida"
  cat "$saida"
  bash "$scripts_dir/validar-hey.sh" "$saida" 429
  exit 0
fi

if [[ "${DEMO_RATE_LIMIT_ELEVATED:-}" != "true" ]]; then
  echo "Defina DEMO_RATE_LIMIT_ELEVATED=true somente depois de aplicar o overlay temporário do rate limit." >&2
  exit 2
fi

replicas_originais="$(kubectl get deployment/animais -n "$namespace" -o jsonpath='{.spec.replicas}')"
temporario="$(mktemp -d)"
limpar() {
  kubectl scale deployment/animais -n "$namespace" --replicas="$replicas_originais" >&2 || true
  rm -f -- "$temporario/distribuicao" "$temporario/headers" "$temporario/contagem" "$temporario/hey"
  rmdir -- "$temporario"
}
trap limpar EXIT

contar_por_pod() {
  local replicas="$1" status pod arquivo="$temporario/distribuicao" cabecalhos="$temporario/headers"
  : > "$arquivo"
  for _ in $(seq 300); do
    status="$(curl --silent --show-error --max-time 10 --output /dev/null --dump-header "$cabecalhos" --write-out '%{http_code}' "$url")"
    [[ "$status" == 200 ]] || { echo "Busca respondeu $status; carga inválida (confira rate limit)." >&2; return 1; }
    pod="$(awk 'tolower($1) == "x-animais-served-by:" {gsub("\r", "", $2); print $2}' "$cabecalhos")"
    [[ -n "$pod" && "$pod" != desconhecido ]] || { echo "Header da réplica ausente nesta resposta." >&2; return 1; }
    printf '%s\n' "$pod" >> "$arquivo"
  done
  if [[ ! -s "$arquivo" ]]; then
    echo "O BFF Mobile não devolveu X-Animais-Served-By; interrompendo a demonstração." >&2
    return 1
  fi
  sort "$arquivo" | uniq -c | tee "$temporario/contagem"
  awk -v replicas="$replicas" '
    {pods++; total += $1; if (replicas == 3 && $1 > 150) invalida=1}
    END {exit !(total == 300 && pods == replicas && !invalida)}
  ' "$temporario/contagem" || { echo "Distribuição não atende ao critério de $replicas réplica(s)." >&2; return 1; }
}

medir() {
  local replicas="$1"
  echo "== ${replicas} réplica(s) =="
  kubectl scale deployment/animais --namespace "$namespace" --replicas="$replicas"
  kubectl rollout status deployment/animais --namespace "$namespace" --timeout=90s
  kubectl get pods --namespace "$namespace" --selector app=animais -o wide
  if [[ "$replicas" == 3 ]]; then
    nos="$(kubectl get pods -n "$namespace" -l app=animais --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | sort -u | awk 'NF {n++} END {print n+0}')"
    [[ "$nos" -ge 2 ]] || { echo "As três réplicas precisam ocupar pelo menos dois nós." >&2; return 1; }
  fi
  # O KIC propaga endpoints depois do rollout; a amostra abaixo continua exigindo 200.
  sleep 5
  echo "Distribuição de 300 requisições:"
  contar_por_pod "$replicas"
  echo "Carga (20 s, concorrência 20):"
  hey -z 20s -c 20 "$url" > "$temporario/hey"
  cat "$temporario/hey"
  bash "$scripts_dir/validar-hey.sh" "$temporario/hey"
}

medir 1
medir 3
