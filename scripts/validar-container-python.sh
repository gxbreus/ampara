#!/usr/bin/env bash
# Valida as imagens e as dependências reais em um projeto Compose isolado.
set -euo pipefail

cd "$(dirname "$0")/.."
servico=$1
case "$servico" in
  notificacoes) porta=8002 ;;
  assistente) porta=8003 ;;
  *) echo "Informe notificacoes ou assistente" >&2; exit 2 ;;
esac

ambiente=$(mktemp)
projeto="ampara-teste-$servico-$$"
single="ampara/$servico:$projeto"
compose() { docker compose --env-file "$ambiente" -p "$projeto" "$@"; }
limpar() {
  local resultado=$?
  if (( resultado != 0 )); then
    compose ps -a >&2 || true
    compose logs --tail=40 "$servico" >&2 || true
  fi
  compose down -v --remove-orphans >/dev/null || true
  docker image rm "$single" >/dev/null 2>&1 || true
  rm -f "$ambiente"
}
trap limpar EXIT

# Valores efêmeros satisfazem a interpolação, inclusive dos serviços fora do teste.
senha_teste=$(openssl rand -hex 16)
while read -r variavel; do
  printf '%s=%s\n' "$variavel" "$senha_teste"
done < <(grep -oE '\$\{[A-Z][A-Z0-9_]*:\?' compose.yaml | cut -c 3- | sed 's/:?$//' | sort -u) > "$ambiente"
export LLM_API_KEY=
compose config -q
compose up -d --build --wait --wait-timeout 150 "$servico"

checar_http() {
  compose exec -T "$servico" python - "$porta" "$1" "$2" <<'PY'
import json
import socket
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

port, path, expected = sys.argv[1:]
request = Request(
    f"http://127.0.0.1:{port}{path}", headers={"X-Correlation-Id": "teste-compose"}
)
try:
    response = urlopen(request, timeout=5)
except HTTPError as error:
    response = error
with response:
    assert response.status == int(expected), (path, response.status, expected)
    assert response.headers["X-Served-By"] == socket.gethostname()
    assert response.headers["X-Correlation-Id"] == "teste-compose"
    status = "ok" if expected == "200" else "indisponivel"
    assert json.load(response) == {"status": status}
    print(f"{path} respondeu {response.status}, com cabeçalhos de rastreabilidade.")
PY
}

aguardar_prontidao() {
  local esperado=$1
  for ((tentativa=1; tentativa<=60; tentativa++)); do
    if checar_http /ready "$esperado" 2>/dev/null; then
      return
    fi
    sleep 1
  done
  checar_http /ready "$esperado"
}

checar_http /health 200
aguardar_prontidao 200
test "$(compose exec -T "$servico" id -u)" != 0
compose logs --no-color --no-log-prefix "$servico" \
  | grep -E '"correlationId": *"teste-compose"' >/dev/null
echo "Usuário não-root e logs com correlationId conferidos."

if [[ $servico == notificacoes ]]; then
  redis_id=$(compose ps -q redis-notificacoes)
  test -z "$(docker port "$redis_id")"
  compose exec -T redis-notificacoes env -u REDISCLI_AUTH redis-cli ping \
    | grep -q 'NOAUTH'
  compose exec -T redis-notificacoes redis-cli CONFIG GET appendfsync \
    | grep -qx 'everysec'
  test "$(compose exec -T redis-notificacoes redis-cli SET teste 1)" = OK
  compose restart redis-notificacoes
  aguardar_prontidao 200
  valor=$(compose exec -T redis-notificacoes redis-cli GET teste)
  test "$valor" = 1
  echo "Redis após reinício: GET teste = $valor"
  for dependencia in redis-notificacoes rabbitmq; do
    compose stop "$dependencia"
    aguardar_prontidao 503
    checar_http /health 200
    compose start "$dependencia"
    aguardar_prontidao 200
  done
else
  compose exec -T "$servico" python - <<'PY'
import json
from urllib.request import Request, urlopen

request = Request(
    "http://qdrant-assistente:6333/collections/teste",
    data=b'{"vectors":{"size":2,"distance":"Cosine"}}',
    headers={"Content-Type": "application/json"},
    method="PUT",
)
with urlopen(request, timeout=5) as response:
    assert json.load(response)["result"] is True
PY
  compose restart qdrant-assistente
  aguardar_prontidao 200
  compose exec -T "$servico" python - <<'PY'
import json
from urllib.request import urlopen

with urlopen("http://qdrant-assistente:6333/collections", timeout=5) as response:
    assert {"name": "teste"} in json.load(response)["result"]["collections"]
print("Qdrant após reinício: coleção teste presente.")
PY
  LLM_API_KEY=invalida compose up -d --force-recreate --no-deps "$servico"
  aguardar_prontidao 200
  checar_http /health 200
  echo "Assistente saudável com chave do LLM vazia e com chave inválida."
fi

# Mesmo código, dependências e base nas duas medições.
awk '
  /^FROM .* AS runtime$/ { runtime = 1 }
  runtime && /^COPY --from=builder / {
    print "COPY requirements.txt ./"
    print "RUN python -m venv /opt/venv && pip install --no-cache-dir -r requirements.txt && pip uninstall -y pip"
    next
  }
  runtime { print }
' "services/$servico/Dockerfile" | docker build -f - -t "$single" "services/$servico"
docker image inspect --format '{{index .RepoTags 0}} {{.Size}} bytes' "$single" "ampara/$servico:dev"
