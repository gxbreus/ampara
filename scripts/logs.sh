#!/usr/bin/env bash
# Logs de um serviço em formato legível. Os serviços logam em JSON, uma linha por evento,
# e cada linguagem usa nomes de campo diferentes (Go: msg/level, Python: mensagem/nivel,
# Node/pino: msg e level numérico). Este script mostra hora, nível, mensagem e, quando há,
# método, caminho, status e duração. As checagens /health e /ready ficam de fora.
#   ./scripts/logs.sh animais              # no cluster (namespace ampara)
#   ./scripts/logs.sh animais compose      # no docker compose
#   TODOS=1 ./scripts/logs.sh animais      # inclui /health e /ready
#   LINHAS=100 ./scripts/logs.sh adocao
set -euo pipefail

servico="${1:?uso: $0 <servico> [compose]}"
linhas="${LINHAS:-30}"

if [ "${2:-k8s}" = compose ]; then
  bruto() { docker compose logs --no-log-prefix --tail 500 "$servico"; }
else
  bruto() { kubectl logs -n ampara "deploy/$servico" --tail 500; }
fi

bruto 2>&1 | jq -rR --arg todos "${TODOS:-}" '
  (fromjson? // null) as $l
  | if $l == null or ($l | type) != "object" then
      # linha que não é JSON (por exemplo, o log de acesso do uvicorn)
      if $todos == "" and test("/(health|ready)") then empty else . end
    else
      ($l.caminho // $l.req.url // "") as $caminho
      | if $todos == "" and ($caminho | test("/(health|ready)$")) then empty else
          ($l.level // $l.nivel // "") as $nivel
          | (if ($nivel | type) == "number" then
               {"10":"TRACE","20":"DEBUG","30":"INFO","40":"WARN","50":"ERROR","60":"FATAL"}[$nivel | tostring]
             else $nivel | ascii_upcase end) as $nivel
          | ($l.time // $l.timestamp // "") as $hora
          | (if ($hora | type) == "number" then ($hora / 1000 | strftime("%H:%M:%S"))
             else ($hora | tostring | capture("(?<h>[0-9]{2}:[0-9]{2}:[0-9]{2})").h // $hora) end) as $hora
          | [ $hora, $nivel,
              ($l.msg // $l.mensagem // $l.message // ""),
              ($l.metodo // $l.req.method // empty),
              (if $caminho != "" then $caminho else empty end),
              (($l.status // $l.res.statusCode // empty) | tostring),
              (($l.duracaoMs // $l.responseTime // empty) | tostring | . + " ms")
            ] | join("  ")
        end
    end' | tail -n "$linhas"
