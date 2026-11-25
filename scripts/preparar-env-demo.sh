#!/usr/bin/env bash
# Gera um .env de demonstração com senhas aleatórias e o par de chaves do JWT.
# Não sobrescreve um .env que já exista. As senhas ficam só no .env (que o Git ignora).
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$raiz/.env"

if [ -f "$env_file" ]; then
  echo ".env já existe; nada a fazer (apague-o para gerar outro)"
  exit 0
fi

senha() { openssl rand -hex 16; }
# a senha das contas da demo é digitada no login, então é curta e legível
senha_demo="ampara-$(openssl rand -hex 3)"

IDENTIDADE_DB_PASSWORD="$(senha)"
ANIMAIS_DB_PASSWORD="$(senha)"
NOTIFICACOES_REDIS_PASSWORD="$(senha)"
ASSISTENTE_REDIS_PASSWORD="$(senha)"
RABBITMQ_ANIMAIS_PASSWORD="$(senha)"
RABBITMQ_IDENTIDADE_PASSWORD="$(senha)"
RABBITMQ_NOTIFICACOES_PASSWORD="$(senha)"
mongo="mongodb://animais:${ANIMAIS_DB_PASSWORD}@mongo-animais:27017"

declare -A valores=(
  [IDENTIDADE_DB_USER]=identidade
  [IDENTIDADE_DB_PASSWORD]="$IDENTIDADE_DB_PASSWORD"
  [IDENTIDADE_DATABASE_URL]="postgresql://identidade:${IDENTIDADE_DB_PASSWORD}@postgres-identidade:5432/identidade"
  [ANIMAIS_DB_USER]=animais
  [ANIMAIS_DB_PASSWORD]="$ANIMAIS_DB_PASSWORD"
  [ANIMAIS_MONGO_URL]="${mongo}/animais?replicaSet=rs0&authSource=admin"
  [ANIMAIS_LEITURA_MONGO_URL]="${mongo}/animais_leitura?replicaSet=rs0&authSource=admin"
  [ADOCAO_DB_USER]=adocao
  [ADOCAO_DB_PASSWORD]="$(senha)"
  [ORQUESTRADOR_DB_USER]=orquestrador
  [ORQUESTRADOR_DB_PASSWORD]="$(senha)"
  [NOTIFICACOES_REDIS_PASSWORD]="$NOTIFICACOES_REDIS_PASSWORD"
  [NOTIFICACOES_REDIS_URL]="redis://:${NOTIFICACOES_REDIS_PASSWORD}@redis-notificacoes:6379/0"
  [ASSISTENTE_REDIS_PASSWORD]="$ASSISTENTE_REDIS_PASSWORD"
  [ASSISTENTE_REDIS_URL]="redis://:${ASSISTENTE_REDIS_PASSWORD}@redis-assistente:6379/0"
  [RABBITMQ_ADMIN_USER]=admin
  [RABBITMQ_ADMIN_PASSWORD]="$(senha)"
  [RABBITMQ_ADOCAO_PASSWORD]="$(senha)"
  [RABBITMQ_ANIMAIS_PASSWORD]="$RABBITMQ_ANIMAIS_PASSWORD"
  [RABBITMQ_IDENTIDADE_PASSWORD]="$RABBITMQ_IDENTIDADE_PASSWORD"
  [RABBITMQ_NOTIFICACOES_PASSWORD]="$RABBITMQ_NOTIFICACOES_PASSWORD"
  [RABBITMQ_ORQUESTRADOR_PASSWORD]="$(senha)"
  [RABBITMQ_BFF_WEB_PASSWORD]="$(senha)"
  [SEED_SENHA_DEMO]="$senha_demo"
  [ANIMAIS_AMQP_URL]="amqp://animais:${RABBITMQ_ANIMAIS_PASSWORD}@rabbitmq:5672/"
  [IDENTIDADE_AMQP_URL]="amqp://identidade:${RABBITMQ_IDENTIDADE_PASSWORD}@rabbitmq:5672/"
  [NOTIFICACOES_AMQP_URL]="amqp://notificacoes:${RABBITMQ_NOTIFICACOES_PASSWORD}@rabbitmq:5672/"
)

# copia o .env.example e preenche só as chaves vazias que estão na tabela acima
while IFS= read -r linha; do
  chave="${linha%%=*}"
  if [[ "$linha" =~ ^[A-Z_]+=$ ]] && [ -n "${valores[$chave]:-}" ]; then
    printf '%s=%s\n' "$chave" "${valores[$chave]}"
  else
    printf '%s\n' "$linha"
  fi
done < "$raiz/.env.example" > "$env_file"
chmod 600 "$env_file"

"$raiz/scripts/gerar-chaves-jwt.sh"
echo ".env de demonstração criado (LLM_API_KEY vazia: o Assistente sobe em modo degradado)"
echo "senha das contas da demo (SEED_SENHA_DEMO): $senha_demo"
