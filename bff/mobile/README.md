# BFF Mobile

Backend for Frontend do **App Mobile** (adotantes): respostas enxutas, distância e o status da solicitação do próprio adotante.

| | |
| --- | --- |
| **Stack** | Node.js 22 + TypeScript + Fastify |
| **Porta interna** | `3020` |
| **Rota no gateway** | `/mobile/v1` |
| **Banco** | nenhum (agrega dados dos serviços) |
| **Responsável** | Gabriel Cantanhede |

O schema de resposta do Fastify define exatamente os campos que o cliente recebe. A comparação com o outro BFF fica em `docs/contratos/bff-comparacao.md`.

## Issues

- #30 — contrato
- #45 — esqueleto e Dockerfile
- #47 — Kubernetes
- #62 — busca, detalhe e solicitações
