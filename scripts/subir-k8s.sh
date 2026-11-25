#!/usr/bin/env bash
# Sobe o cluster kind do zero, na ordem do k8s/README.md: cluster, Kong Ingress
# Controller, secret.env, imagens e manifests. Pode rodar de novo: cada passo é idempotente.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
cd "$raiz"
[ -f .env ] || { echo "falta o .env: rode ./scripts/preparar-env-demo.sh" >&2; exit 1; }

imagens=(rabbitmq mongo adocao orquestrador bff-web identidade animais bff-mobile notificacoes assistente)

echo "== 1/5 cluster kind"
kind get clusters 2>/dev/null | grep -qx ampara || kind create cluster --config k8s/kind-config.yaml

echo "== 2/5 Kong Ingress Controller"
helm repo add kong https://charts.konghq.com >/dev/null 2>&1 || true
helm repo update kong >/dev/null
helm upgrade --install kong kong/ingress --namespace kong --create-namespace \
  --values k8s/kong/values.yaml --wait --timeout 5m

echo "== 3/5 secret.env e chaves JWT"
./scripts/k8s-prep.sh

echo "== 4/5 imagens"
docker compose build
for img in "${imagens[@]}"; do
  kind load docker-image "ampara/$img:dev" --name ampara
done

echo "== 5/5 manifests"
kubectl apply -k k8s/
kubectl wait --for=condition=Ready pod --all -n ampara --timeout 10m
kubectl get pods -n ampara -o wide
echo "Ingress em http://localhost:8000 (teste: ./scripts/teste-rotas.sh)"
