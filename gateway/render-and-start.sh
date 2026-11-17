#!/bin/sh
set -eu

: "${JWT_PUBLIC_KEY:?JWT_PUBLIC_KEY precisa conter a chave pública RS256}"

# O PEM é uma string de múltiplas linhas. A chave vai para um bloco YAML e a
# variável original nunca é gravada no template versionado.
export JWT_PUBLIC_KEY_YAML="$(printf '%s\n' "$JWT_PUBLIC_KEY" | sed 's/^/          /')"
envsubst '${JWT_PUBLIC_KEY_YAML}' < /kong/kong.template.yml > /kong/kong.yml

exec /docker-entrypoint.sh kong docker-start
