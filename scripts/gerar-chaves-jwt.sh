#!/usr/bin/env bash
# Gera o par de chaves RS256 do JWT e grava JWT_PRIVATE_KEY e JWT_PUBLIC_KEY no .env,
# numa linha só, com as quebras escapadas como \n (o formato que o gateway espera).
# Rodar de novo troca o par: tokens emitidos com a chave antiga deixam de valer.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$raiz/.env"

if [ ! -f "$env_file" ]; then
  cp "$raiz/.env.example" "$env_file"
  echo "criado .env a partir do .env.example"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/privada.pem" 2>/dev/null
openssl pkey -in "$tmp/privada.pem" -pubout -out "$tmp/publica.pem"

uma_linha() { awk '{printf "%s\\n", $0}' "$1"; }

grava() {
  local chave="$1" valor="$2"
  grep -v "^${chave}=" "$env_file" > "$tmp/env" || true
  printf '%s="%s"\n' "$chave" "$valor" >> "$tmp/env"
  cat "$tmp/env" > "$env_file"
}

grava JWT_PRIVATE_KEY "$(uma_linha "$tmp/privada.pem")"
grava JWT_PUBLIC_KEY "$(uma_linha "$tmp/publica.pem")"
chmod 600 "$env_file"

echo "JWT_PRIVATE_KEY e JWT_PUBLIC_KEY gravadas em .env"
