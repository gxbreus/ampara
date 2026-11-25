#!/usr/bin/env bash
# Popula o sistema com dados de demonstração:
# 1. Identidade: as contas da demo (duas ONGs, protetora, admin, a adotante principal com
#    perfil completo e seis adotantes dos pedidos prontos, um deles com perfil incompleto);
# 2. Animais: os três responsáveis como verificados e 20 animais com foto, em bairros de
#    Lavras e em Ribeirão Vermelho, Ijaci e Perdões;
# 3. Adoção: pedidos reais pela SAGA, para o painel ter AGUARDANDO_APROVACAO, CONCLUIDA,
#    RECUSADA e PERFIL_INVALIDO (scripts/seed/seed_pedidos.py, roda no container de Animais).
#   ./scripts/seed.sh            # no docker compose
#   ./scripts/seed.sh k8s        # no cluster kind (namespace ampara)
# As contas usam ids fixos, os mesmos do seed de Animais e do login de desenvolvimento dos
# apps. A senha delas é SEED_SENHA_DEMO do .env. A chave privada do JWT e a senha saem do
# .env e só existem dentro do processo do seed. Rodar de novo não duplica contas, animais nem
# pedidos.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
cd "$raiz"
ler() { grep "^$1=" .env | cut -d= -f2- | sed 's/^"//; s/"$//'; }
chave="$(ler JWT_PRIVATE_KEY)"
senha="$(ler SEED_SENHA_DEMO)"
[ -n "$chave" ] || { echo "JWT_PRIVATE_KEY vazia no .env" >&2; exit 1; }
[ "${#senha}" -ge 8 ] || { echo "defina SEED_SENHA_DEMO no .env (mínimo 8 caracteres): é a senha das contas da demo" >&2; exit 1; }
# sem kubectl no host, aponte para um que exista, por exemplo o do nó do kind:
# KUBECTL="docker exec -i ampara-control-plane kubectl --kubeconfig /etc/kubernetes/admin.conf"
kubectl="${KUBECTL:-kubectl}"
case "${1:-compose}" in
  compose)
    docker compose exec -T -e SEED_SENHA="$senha" identidade node - < scripts/seed/seed_identidade.js
    docker compose exec -T -e JWT_PRIVATE_KEY="$chave" animais python - < scripts/seed/seed_animais.py
    docker compose exec -T -e JWT_PRIVATE_KEY="$chave" animais python - < scripts/seed/seed_pedidos.py
    ;;
  k8s)
    $kubectl exec -i -n ampara deploy/identidade -- env SEED_SENHA="$senha" node - < scripts/seed/seed_identidade.js
    $kubectl exec -i -n ampara deploy/animais -- env JWT_PRIVATE_KEY="$chave" python - < scripts/seed/seed_animais.py
    $kubectl exec -i -n ampara deploy/animais -- env JWT_PRIVATE_KEY="$chave" python - < scripts/seed/seed_pedidos.py
    ;;
  *) echo "uso: $0 [compose|k8s]" >&2; exit 2 ;;
esac
echo "contas da demo (senha SEED_SENHA_DEMO do .env): ong@, ong2@, protetor@, admin@ e adotante@ampara.dev;"
echo "adotantes dos pedidos prontos: carlos@, ana@, juliana@, pedro@, lucas@ (perfil incompleto) e marcos@ampara.dev"
