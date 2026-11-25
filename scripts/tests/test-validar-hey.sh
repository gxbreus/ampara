#!/usr/bin/env bash
set -euo pipefail
scripts_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
saida="$(mktemp)"
trap 'rm -f -- "$saida"' EXIT

cat > "$saida" <<'SAIDA'
Response time histogram:
  0.036 [412] |■■■
Status code distribution:
  [200] 1000 responses
SAIDA
bash "$scripts_dir/validar-hey.sh" "$saida"

cat >> "$saida" <<'SAIDA'
  [429] 1 responses
SAIDA
if bash "$scripts_dir/validar-hey.sh" "$saida"; then exit 1; fi
bash "$scripts_dir/validar-hey.sh" "$saida" 429

printf 'Response time histogram:\n  0.036 [200] |■\n' > "$saida"
if bash "$scripts_dir/validar-hey.sh" "$saida"; then exit 1; fi

printf 'Status code distribution:\n  [200] 10 responses\nError distribution:\n  timeout\n' > "$saida"
if bash "$scripts_dir/validar-hey.sh" "$saida"; then exit 1; fi
echo "4 cenários do parser hey aprovados (saídas simuladas)."
