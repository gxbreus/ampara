# Adoção

Solicitações de adoção e **orquestrador da SAGA**: máquina de estados persistida, outbox para comandos e eventos, inbox para respostas, timeouts e retomada. Expõe a solicitação com **HATEOAS** (HAL).

| | |
| --- | --- |
| **Stack** | Go |
| **Porta interna** | `8080` |
| **Banco** | PostgreSQL (`postgres-adocao`) |
| **Responsável** | Mateus Vitor |

Ainda não há código aqui. O esqueleto (`/health`, `/ready`, Dockerfile multi-stage) é criado na issue de esqueleto abaixo.

## Issues

- #22 — contrato OpenAPI com HATEOAS
- #25 — catálogo de mensagens
- #26 — modelagem da SAGA
- #32 — outbox
- #40 — esqueleto e Dockerfile
- #48 — Kubernetes
- #58 — orquestrador da SAGA
- #59 — aprovar, recusar, cancelar e expirar

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
