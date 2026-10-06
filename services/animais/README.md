# Animais

Catálogo de animais (fotos, status, localização) e reserva durante a SAGA. Aplica **CQRS**: escrita no database `animais` e busca geográfica servida pela projeção `animais_leitura.animais_busca`.

| | |
| --- | --- |
| **Stack** | Python + FastAPI |
| **Porta interna** | `8001` |
| **Banco** | MongoDB em replica set (`mongo-animais`) |
| **Responsável** | Gabriel Cantanhede |

Ainda não há código aqui. O esqueleto (`/health`, `/ready`, Dockerfile multi-stage) é criado na issue de esqueleto abaixo.

## Issues

- #21 — contrato OpenAPI
- #33 — CQRS
- #39 — esqueleto e Dockerfile
- #47 — Kubernetes
- #55 — modelo de escrita e outbox
- #56 — projeção e busca
- #57 — participante da SAGA

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
