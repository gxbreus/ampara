#!/usr/bin/env bash
# Busca pública de animais (raio de 10 km em Lavras, MG) mostrada como tabela, para a
# demonstração. Faz a mesma chamada que o app mobile: GET /mobile/v1/animais pelo gateway.
#   ./scripts/buscar-animais.sh          # kind: Ingress em localhost:8000
#   ./scripts/buscar-animais.sh 8080     # compose no Codespace: gateway em localhost:8080
set -euo pipefail

porta="${1:-8000}"
url="http://localhost:$porta/mobile/v1/animais?lat=-21.24&lng=-45.00&raioKm=10"
corpo="$(mktemp)"
trap 'rm -f "$corpo"' EXIT

status="$(curl -s -o "$corpo" -w '%{http_code}' "$url" || true)"
echo "GET $url → HTTP $status"
echo

case "$status" in
  200) ;;
  429) echo "Rate limit atingido (429). Espere até 1 minuto e rode de novo."; exit 1 ;;
  502|503) echo "O gateway ainda não alcança o serviço ($status). Espere os pods ficarem 1/1 e rode de novo."; exit 1 ;;
  000) echo "Nada respondendo na porta $porta. O ambiente está de pé?"; exit 1 ;;
  *) cat "$corpo"; echo; exit 1 ;;
esac

total="$(jq '.itens | length' "$corpo")"
if [ "$total" -eq 0 ]; then
  echo "Nenhum animal disponível no raio (banco vazio). Rode ./scripts/seed.sh para popular."
  exit 0
fi

{
  printf 'NOME\tESPÉCIE\tPORTE\tSEXO\tIDADE\tDISTÂNCIA\tRESPONSÁVEL\n'
  jq -r '.itens[] | [
      .nome, .especie, .porte, .sexo,
      (if .idadeMeses >= 12 then "\(.idadeMeses / 12 | floor) ano(s)" else "\(.idadeMeses) mes(es)" end),
      "\(.distanciaKm) km",
      .responsavel.nome
    ] | @tsv' "$corpo"
} | column -t -s $'\t'
echo
echo "$total animais disponíveis, do mais próximo ao mais distante."
