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
| `GET /web/v1/solicitacoes` | `PROTETOR`, `ONG` ou `ADMIN` | solicitações recebidas (Adoção), com o adotante (Identidade) e o animal (Animais) numa chamada por serviço |
| `GET /web/v1/solicitacoes/{id}` | `PROTETOR`, `ONG` ou `ADMIN` | a solicitação com a linha do tempo, o adotante e o animal |
| `POST /web/v1/solicitacoes/{id}/aprovacao` e `/recusa` | `PROTETOR`, `ONG` ou `ADMIN` | repassa a decisão para a Adoção e responde 202 |
| `GET /web/v1/admin/contas` | `ADMIN` | fila de verificação da Identidade (`PENDENTE_VERIFICACAO` por padrão) |
| `PUT /web/v1/admin/contas/{id}/verificacao` | `ADMIN` | verifica um protetor ou ONG na Identidade |

As rotas de animais e o `/painel` entram quando Animais existir (#21, #55).

- **JWT:** o BFF verifica de novo o token que o gateway já validou (assinatura RS256 com a chave pública, emissor `ampara-identidade`, expiração) e confere a role. O `Authorization` original é repassado aos serviços.
- **Chamadas internas:** repassam `X-Correlation-Id` e `Authorization`, com timeout de 3 s (`BFF_TIMEOUT_MS`). Os nomes são resolvidos pelo c-ares, e não pelo `dns.lookup`, para que um serviço fora do ar não esgote o pool de threads do Node e atrase os outros (detalhe em `src/cliente.ts`).
- **Falha parcial:** se a Adoção, que é essencial nas rotas de solicitações, não responde ou responde 5xx, a rota dá 503. Se a Identidade ou Animais falham, a resposta sai com 200, os campos deles `null` e um item em `avisos`. Sem Animais, o nome do animal vem da cópia que a Adoção guardou (`animalNome`), e a foto fica `null`. Os 4xx do serviço essencial (404, 409, 422) chegam ao painel como vieram.
- **Links:** os `_links` da Adoção saem traduzidos de `/v1/...` para `/web/v1/...`, só com `self`, `animal`, `aprovar` e `recusar`.
- **Testes:** os serviços são falsos, com respostas tiradas dos contratos, e toda resposta de sucesso é validada contra o schema de `docs/contratos/bff-web.v1.yaml`.
- **Logs:** JSON (pino), com `correlationId` em toda linha. Toda resposta traz `X-Served-By` e `X-Correlation-Id`.

## Issues

- #29 — contrato
- #44 — esqueleto e Dockerfile
- #48 — Kubernetes
- #61 — agregações do painel
