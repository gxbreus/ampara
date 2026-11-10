#!/usr/bin/env bash
set -euo pipefail

base_url="${BASE_URL:-http://localhost:8000}"

codigo() {
  curl --silent --output /dev/null --write-out '%{http_code}' "$@"
}

echo "web sem token (espera 401):       $(codigo "$base_url/web/v1/health")"
echo "busca pública (espera 200):       $(codigo "$base_url/mobile/v1/animais")"
echo "POST busca sem token (espera 401): $(codigo -X POST "$base_url/mobile/v1/animais")"
echo "rate limit de auth (espera 429):"
for _ in $(seq 25); do
  codigo -X POST "$base_url/auth/v1/sessoes"
  printf '\n'
done | sort | uniq -c
