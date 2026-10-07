#!/usr/bin/env bash
# Gera os arquivos locais que os manifests do Kubernetes precisam, a partir do .env da raiz.
# Nada do que ele gera vai para o Git (.gitignore).
#
# - k8s/<componente>/secret.env, a partir do secret.env.example da mesma pasta. Cada linha
#   do exemplo é "CHAVE=" (copia a variável de mesmo nome do .env) ou "CHAVE=modelo", onde
#   o modelo usa ${VARIAVEL} do .env, por exemplo uma URL montada com usuário e senha.
# - o par RS256 do JWT: jwt.key em k8s/identidade/, que assina, e jwt.pub em k8s/gateway/
#   e nos BFFs, que só validam. Só nas pastas que existirem.
#
# Rodar de novo gera o mesmo resultado.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$raiz/.env"
[ -f "$env_file" ] || { echo "falta o .env: cp .env.example .env e ./scripts/gerar-chaves-jwt.sh" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

# troca cada ${VAR} pelo valor da variável; falha se ela estiver vazia
expandir() {
  local texto="$1" nome valor
  while [[ "$texto" =~ \$\{([A-Za-z_][A-Za-z0-9_]*)\} ]]; do
    nome="${BASH_REMATCH[1]}"
    valor="${!nome:-}"
    [ -n "$valor" ] || { echo "variável $nome vazia no .env" >&2; return 1; }
    texto="${texto//\$\{$nome\}/$valor}"
  done
  printf '%s' "$texto"
}

gerados=0
for exemplo in "$raiz"/k8s/*/secret.env.example; do
  [ -f "$exemplo" ] || continue
  pasta="$(dirname "$exemplo")"
  saida="$pasta/secret.env"
  : > "$saida.tmp"
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in ''|\#*) continue ;; esac
    chave="${linha%%=*}"
    modelo="${linha#*=}"
    [ -n "$modelo" ] || modelo="\${$chave}"
    valor="$(expandir "$modelo")" || { rm -f "$saida.tmp"; echo "em ${exemplo#"$raiz"/}" >&2; exit 1; }
    printf '%s=%s\n' "$chave" "$valor" >> "$saida.tmp"
  done < "$exemplo"
  mv "$saida.tmp" "$saida"
  chmod 600 "$saida"
  echo "gerado ${saida#"$raiz"/}"
  gerados=$((gerados + 1))
done

# o .env guarda as chaves numa linha só, com \n escapado
pem() { printf '%b\n' "$1"; }

[ -n "${JWT_PRIVATE_KEY:-}" ] && [ -n "${JWT_PUBLIC_KEY:-}" ] || {
  echo "falta o par JWT no .env: rode ./scripts/gerar-chaves-jwt.sh" >&2; exit 1; }

if [ -d "$raiz/k8s/identidade" ]; then
  pem "$JWT_PRIVATE_KEY" > "$raiz/k8s/identidade/jwt.key" && chmod 600 "$raiz/k8s/identidade/jwt.key"
  echo "gerado k8s/identidade/jwt.key"
fi
for pasta in gateway bff-web bff-mobile; do
  if [ -d "$raiz/k8s/$pasta" ]; then
    pem "$JWT_PUBLIC_KEY" > "$raiz/k8s/$pasta/jwt.pub"
    echo "gerado k8s/$pasta/jwt.pub"
  fi
done

echo "pronto: $gerados secret.env gerados"
