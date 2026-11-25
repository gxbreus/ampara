#!/usr/bin/env bash
# Confere as políticas do gateway (Kong): JWT, rota pública e rate limit, as mesmas da
# Parte 2. Mostra cada verificação com o status esperado e o obtido.
#   ./scripts/teste-rotas.sh          # kind: Ingress em localhost:8000
#   ./scripts/teste-rotas.sh 8080     # compose no Codespace: gateway em localhost:8080
# O rate limit de /auth/v1 é 20 por minuto: depois deste teste, /auth/v1 fica bloqueado
# por até 1 minuto. As outras rotas não são afetadas.
set -euo pipefail

base_url="${BASE_URL:-http://localhost:${1:-8000}}"
busca="$base_url/mobile/v1/animais?lat=-21.24&lng=-45.00&raioKm=10"
ok=0
total=0

codigo() {
  curl --silent --output /dev/null --write-out '%{http_code}' "$@" || true
}

verificar() {
  local descricao="$1" esperado="$2" obtido="$3" explicacao="$4" marca="✘"
  total=$((total + 1))
  if [ "$obtido" = "$esperado" ]; then marca="✔"; ok=$((ok + 1)); fi
  printf '  %s %-38s esperado %s, obtido %s  (%s)\n' "$marca" "$descricao" "$esperado" "$obtido" "$explicacao"
}

echo "Políticas do gateway em $base_url"
echo

verificar "GET  /web/v1 sem token" 401 "$(codigo "$base_url/web/v1/health")" \
  "o painel web exige JWT"
verificar "GET  /mobile/v1/animais (busca)" 200 "$(codigo "$busca")" \
  "a busca é pública, sem token"
verificar "POST /mobile/v1/animais sem token" 401 "$(codigo -X POST "$base_url/mobile/v1/animais")" \
  "fora a busca, o mobile exige JWT"

# 25 chamadas seguidas em /auth/v1, cujo limite é 20 por minuto: as que passam do limite
# voltam 429. As que passam chegam à Identidade (o login em si entra na Parte 4).
bloqueadas=0
for _ in $(seq 25); do
  [ "$(codigo -X POST "$base_url/auth/v1/sessoes")" = 429 ] && bloqueadas=$((bloqueadas + 1))
done
total=$((total + 1))
if [ "$bloqueadas" -ge 5 ]; then marca="✔"; ok=$((ok + 1)); else marca="✘"; fi
printf '  %s %-38s %d passaram, %d bloqueadas com 429  (limite de 20 por minuto)\n' \
  "$marca" "25 chamadas em /auth/v1" "$((25 - bloqueadas))" "$bloqueadas"

echo
echo "$ok de $total verificações como esperado."
[ "$ok" -eq "$total" ]
