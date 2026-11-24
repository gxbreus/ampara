#!/usr/bin/env bash
# Ferramentas que a imagem base não traz: kind e hey. Depois, o .env de demonstração.
set -euo pipefail

KIND_VERSION=v0.25.0

if ! command -v kind >/dev/null; then
  sudo curl -fsSLo /usr/local/bin/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-amd64"
  sudo chmod +x /usr/local/bin/kind
fi

if ! command -v hey >/dev/null; then
  sudo curl -fsSLo /usr/local/bin/hey https://hey-release.s3.us-east-2.amazonaws.com/hey_linux_amd64
  sudo chmod +x /usr/local/bin/hey
fi

./scripts/preparar-env-demo.sh
