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
  limite="$(kubectl get kongplugin rate-limit-mobile -n "$namespace" -o jsonpath='{.config.minute}' 2>/dev/null || true)"
  echo "Teste separado de 429 em /mobile/v1 (limite atual: ${limite:-desconhecido}/min; o normal é 600)."
  if [[ "$limite" =~ ^[0-9]+$ ]] && (( limite > 1200 )); then
    echo "O limite está elevado; rode ./scripts/rate-limit-demo.sh restaurar antes deste teste." >&2
    exit 2
  fi
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
  rm -f -- "$temporario/distribuicao" "$temporario/headers" "$temporario/contagem" "$temporario/hey" \
    "$temporario/pods" "$temporario/sonda"
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

# Pods do Animais que continuam no ar, sem os que estão terminando: "nome nó".
listar_pods() {
  kubectl get pods -n "$namespace" -l app=animais --field-selector=status.phase=Running --no-headers \
    -o custom-columns='NOME:.metadata.name,NO:.spec.nodeName,SAINDO:.metadata.deletionTimestamp' \
    | awk '$3 == "<none>" {print $1, $2}'
}

# Depois do rollout, o Service do Animais e o Kong levam alguns segundos para enxergar os
# endpoints novos (e largar os que saíram). Sonda a busca até que só os pods esperados
# respondam e todos apareçam; desiste depois de 15 tentativas (~30 s).
aguardar_endpoints() {
  local replicas="$1" tentativa status vistos
  for tentativa in $(seq 15); do
    listar_pods > "$temporario/pods"
    : > "$temporario/sonda"
    for _ in $(seq $((replicas * 10))); do
      status="$(curl --silent --max-time 5 --output /dev/null --dump-header "$temporario/headers" --write-out '%{http_code}' "$url" || true)"
      [[ "$status" == 200 ]] || continue
      awk 'tolower($1) == "x-animais-served-by:" {gsub("\r", "", $2); print $2}' "$temporario/headers" >> "$temporario/sonda"
    done
    vistos="$(sort -u "$temporario/sonda" | awk 'NF {n++} END {print n+0}')"
    if [[ "$vistos" == "$replicas" ]] \
      && sort -u "$temporario/sonda" | awk 'NR == FNR {ok[$1] = 1; next} !($1 in ok) {fora = 1} END {exit fora}' "$temporario/pods" -; then
      echo "Endpoints prontos na tentativa $tentativa: $vistos pod(s) respondendo."
      return 0
    fi
    sleep 2
  done
  echo "Os endpoints não refletiram $replicas réplica(s) em ~30 s; não meça agora." >&2
  return 1
}

medir() {
  local replicas="$1"
  echo "== ${replicas} réplica(s) =="
  kubectl scale deployment/animais --namespace "$namespace" --replicas="$replicas"
  kubectl rollout status deployment/animais --namespace "$namespace" --timeout=90s
  kubectl get pods --namespace "$namespace" --selector app=animais -o wide
  if [[ "$replicas" -gt 1 ]]; then
    local nos
    nos="$(listar_pods | awk '{print $2}' | sort -u | awk 'NF {n++} END {print n+0}')"
    [[ "$nos" -ge 2 ]] || { echo "As $replicas réplicas estão em $nos nó(s); o critério pede pelo menos dois." >&2; return 1; }
    echo "Réplicas distribuídas em $nos nós."
  fi
  aguardar_endpoints "$replicas"
  echo "Distribuição de 300 requisições:"
  contar_por_pod "$replicas"
  echo "Carga (20 s, concorrência 20):"
  hey -z 20s -c 20 "$url" > "$temporario/hey"
  cat "$temporario/hey"
  bash "$scripts_dir/validar-hey.sh" "$temporario/hey"
}

medir 1
medir 3
