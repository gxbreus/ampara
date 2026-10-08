#!/bin/bash
# Replica set com autenticação exige um keyFile. Ele é gerado no volume na primeira subida,
# então nunca vai para o repositório. O replica set (rs0) é o que habilita as transações
# do outbox de Animais (docs/dados.md, seção 5.4).
set -euo pipefail

if [ ! -f /data/db/keyfile ]; then
  head -c 756 /dev/urandom | base64 -w 0 > /data/db/keyfile
  chmod 400 /data/db/keyfile
  chown 999:999 /data/db/keyfile
fi

exec docker-entrypoint.sh "$@"
