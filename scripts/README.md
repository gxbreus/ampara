# Scripts

Utilitários de desenvolvimento e demonstração. Previstos:

| Script | Para quê | Issue |
| --- | --- | --- |
| `gerar-chaves-jwt.sh` | gera o par de chaves RS256 local | #37 |
| `k8s-prep.sh` | cria os Secrets do cluster a partir do `secret.env` | #48 |
| `preparar-env-demo.sh` | gera um `.env` de demonstração com senhas aleatórias e as chaves do JWT; não sobrescreve um `.env` existente | — |
| `subir-k8s.sh` | sobe o cluster kind do zero: cluster, Kong Ingress Controller, `secret.env`, imagens e manifests | — |
| `seed.sh` | dados de demonstração: uma ONG e oito animais, pela API de escrita do Animais (`./scripts/seed.sh` no compose, `./scripts/seed.sh k8s` no cluster) | #71 |
| `rate-limit-demo.sh` | eleva e restaura o rate limit de `/mobile/v1` em volta do `escala-demo.sh` | #51 |
| `seed/` | dados de demonstração (ONGs, animais e adotantes) | #71 |
| `demo/` | provoca cada cenário da SAGA ao vivo; `demo/participantes_falsos.py` faz o papel de Animais e da Identidade enquanto os serviços reais não existem | #71 |
| `carga/` | teste de carga da demonstração de escalabilidade | #51 |
| `reconstruir_projecao.py` | reconstrói o read model de Animais do zero | #56 |
| `dlq.sh` | lista, reprocessa e descarta mensagens das DLQs pela API do RabbitMQ (roteiro em `docs/operacao/dlq.md`) | #86 |
