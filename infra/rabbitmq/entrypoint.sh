#!/bin/sh
# Sobe o RabbitMQ e cria, a partir do ambiente, o usuário admin e um usuário por serviço
# com permissões mínimas (docs/contratos/eventos.md, seção 7; #89).
# O definitions.json só traz a topologia: senhas não podem ir para o repositório.
set -eu

: "${RABBITMQ_ADMIN_USER:?defina RABBITMQ_ADMIN_USER}"
: "${RABBITMQ_ADMIN_PASSWORD:?defina RABBITMQ_ADMIN_PASSWORD}"
: "${RABBITMQ_ADOCAO_PASSWORD:?defina RABBITMQ_ADOCAO_PASSWORD}"
: "${RABBITMQ_ANIMAIS_PASSWORD:?defina RABBITMQ_ANIMAIS_PASSWORD}"
: "${RABBITMQ_IDENTIDADE_PASSWORD:?defina RABBITMQ_IDENTIDADE_PASSWORD}"
: "${RABBITMQ_NOTIFICACOES_PASSWORD:?defina RABBITMQ_NOTIFICACOES_PASSWORD}"

PRONTO=/tmp/ampara-usuarios-prontos
rm -f "$PRONTO"

# Cria o cookie do Erlang antes de subir o broker, já com o dono certo. Sem isso, na
# primeira subida o rabbitmqctl abaixo (rodando como root) criaria o arquivo como root,
# e o servidor, que roda como o usuário rabbitmq, cairia com "eacces" ao tentar lê-lo.
COOKIE=/var/lib/rabbitmq/.erlang.cookie
if [ ! -f "$COOKIE" ]; then
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32 > "$COOKIE"
  chmod 400 "$COOKIE"
  chown rabbitmq:rabbitmq "$COOKIE" 2>/dev/null || true
fi

docker-entrypoint.sh rabbitmq-server &
pid=$!
trap 'kill -TERM "$pid"; wait "$pid"' TERM INT

# o await_startup falha na hora se o nó ainda não se registrou, então tenta até 2 minutos
tentativas=0
until rabbitmqctl --quiet await_startup --timeout 10 >/dev/null 2>&1; do
  kill -0 "$pid" 2>/dev/null || { echo "ampara: o RabbitMQ parou antes de subir" >&2; exit 1; }
  tentativas=$((tentativas + 1))
  [ "$tentativas" -lt 60 ] || { echo "ampara: o RabbitMQ não subiu em 2 minutos" >&2; exit 1; }
  sleep 2
done

garantir_usuario() {
  if rabbitmqctl list_users --quiet --no-table-headers | cut -f1 | grep -qx "$1"; then
    rabbitmqctl change_password "$1" "$2" >/dev/null
  else
    rabbitmqctl add_user "$1" "$2" >/dev/null
  fi
  rabbitmqctl set_user_tags "$1" $3 >/dev/null
}

# usuário, senha, tags, configure, write (publica em), read (consome de)
permitir() {
  garantir_usuario "$1" "$2" "$3"
  rabbitmqctl set_permissions -p / "$1" "$4" "$5" "$6" >/dev/null
}

permitir "$RABBITMQ_ADMIN_USER" "$RABBITMQ_ADMIN_PASSWORD" administrator '.*' '.*' '.*'
permitir adocao       "$RABBITMQ_ADOCAO_PASSWORD"       "" '^$' '^ampara\.(comandos|eventos)$'  '^adocao\.respostas(\.dlq)?$'
permitir animais      "$RABBITMQ_ANIMAIS_PASSWORD"      "" '^$' '^ampara\.(respostas|eventos)$' '^animais\.(comandos|projecao)(\.dlq)?$'
permitir identidade   "$RABBITMQ_IDENTIDADE_PASSWORD"   "" '^$' '^ampara\.(respostas|eventos)$' '^identidade\.comandos(\.dlq)?$'
permitir notificacoes "$RABBITMQ_NOTIFICACOES_PASSWORD" "" '^$' '^$'                            '^notificacoes\.eventos(\.dlq)?$'
rabbitmqctl delete_user guest >/dev/null 2>&1 || true

touch "$PRONTO"
echo "ampara: usuários do RabbitMQ prontos"
wait "$pid"
