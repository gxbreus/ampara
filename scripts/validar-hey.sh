#!/usr/bin/env bash
# Analisa somente códigos HTTP: o histograma também contém números entre colchetes.
set -euo pipefail
arquivo="${1:?informe a saída do hey}"
modo="${2:-sucesso}"
if grep -q 'Error distribution:' "$arquivo"; then
  echo "hey registrou erro de rede" >&2
  exit 1
fi
awk -v modo="$modo" '
  /^Status code distribution:/ {status=1; next}
  status && /^[[:space:]]*\[[0-9][0-9][0-9]\]/ {
    codigo=$1; gsub(/\[|\]/, "", codigo)
    total += $2
    if (codigo == 429) limitadas += $2
    if (codigo < 200 || codigo >= 300) erros += $2
    next
  }
  status && /^[^[:space:]]/ {status=0}
  END {
    if (modo == "429") exit !(total > 0 && limitadas > 0)
    exit !(total > 0 && erros == 0)
  }
' "$arquivo" || { echo "Distribuição HTTP do hey não atende ao modo $modo." >&2; exit 1; }
