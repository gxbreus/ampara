#!/usr/bin/env bash
# Ferramentas que a imagem base não traz: kind e hey. Depois, o .env de demonstração.
set -euo pipefail

KIND_VERSION=v0.25.0

if ! command -v kind >/dev/null; then
  sudo curl -fsSLo /usr/local/bin/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
  sudo chmod +x /usr/local/bin/kind
fi

# hey roda pela imagem williamyeh/hey (a mesma da medição em docs/escalabilidade.md), com a
# rede do host, para alcançar o Ingress em localhost:8000.
if ! command -v hey >/dev/null; then
  printf '#!/bin/sh\nexec docker run --rm --network host williamyeh/hey "$@"\n' | sudo tee /usr/local/bin/hey >/dev/null
  sudo chmod +x /usr/local/bin/hey
fi

./scripts/preparar-env-demo.sh
