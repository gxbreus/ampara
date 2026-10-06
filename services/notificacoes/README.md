# Notificações

Consome os eventos de adoção e de conta e mantém a caixa de notificações de cada usuário. Consumidor idempotente; nunca altera o resultado de uma adoção.

| | |
| --- | --- |
| **Stack** | Python + FastAPI |
| **Porta interna** | `8002` |
| **Banco** | Redis com AOF (`redis-notificacoes`) |
| **Responsável** | Gabriel Nakazato |

Ainda não há código aqui. O esqueleto (`/health`, `/ready`, Dockerfile multi-stage) é criado na issue de esqueleto abaixo.

## Issues

- #23 — contrato OpenAPI
- #41 — esqueleto e Dockerfile
- #49 — Kubernetes
- #60 — consumidores e caixa in-app

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
