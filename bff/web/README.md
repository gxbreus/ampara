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

## Rodar

```bash
docker compose up -d --build bff-web   # sobe também a Adoção, o banco dela e o RabbitMQ
npm ci && npm test                      # testes, dentro de bff/web
npm run dev                             # local, com JWT_PUBLIC_KEY e as URLs dos serviços no ambiente
```

| Rota | Autenticação | O que faz |
| --- | --- | --- |
| `GET /web/v1/health` | — | 200 enquanto o processo está de pé |
| `GET /web/v1/ready` | — | 200 se Identidade, Animais e Adoção respondem `/health`; 503 dizendo qual não respondeu |
| `GET /web/v1/eu` | `PROTETOR`, `ONG` ou `ADMIN` | repassa para a Identidade (`GET /v1/contas/eu`) |

- **JWT:** o BFF verifica de novo o token que o gateway já validou (assinatura RS256 com a chave pública, emissor `ampara-identidade`, expiração) e confere a role. O `Authorization` original é repassado aos serviços.
- **Chamadas internas:** repassam `X-Correlation-Id` e `Authorization`, com timeout de 3 s (`BFF_TIMEOUT_MS`). Os nomes são resolvidos pelo c-ares, e não pelo `dns.lookup`, para que um serviço fora do ar não esgote o pool de threads do Node e atrase os outros (detalhe em `src/cliente.ts`).
- **Logs:** JSON (pino), com `correlationId` em toda linha. Toda resposta traz `X-Served-By` e `X-Correlation-Id`.

## Issues

- #29 — contrato
- #44 — esqueleto e Dockerfile
- #48 — Kubernetes
- #61 — agregações do painel
