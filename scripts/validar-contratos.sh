#!/usr/bin/env bash
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporario="$(mktemp -d)"
trap 'rm -rf "$temporario"' EXIT

cd "$raiz"
node scripts/extrair-schemas-mensagens.mjs --check --examples-dir "$temporario/exemplos"
node scripts/validar-schemas-mensagens.mjs "$temporario/exemplos"

npx --yes @redocly/cli@1 lint docs/contratos/*.v1.yaml
