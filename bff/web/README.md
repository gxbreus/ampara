# BFF Web

Backend for Frontend do **App Web** (protetores, ONGs e admin): respostas completas e agregadas para o painel.

| | |
| --- | --- |
| **Stack** | Node.js 22 + TypeScript + Fastify |
| **Porta interna** | `3010` |
| **Rota no gateway** | `/web/v1` |
| **Banco** | nenhum (agrega dados dos serviços) |
| **Responsável** | Mateus Vitor |

O schema de resposta do Fastify define exatamente os campos que o cliente recebe. A comparação com o outro BFF fica em `docs/contratos/bff-comparacao.md`.

## Issues

- #29 — contrato
- #44 — esqueleto e Dockerfile
- #48 — Kubernetes
- #61 — agregações do painel
