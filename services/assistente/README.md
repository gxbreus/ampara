# Assistente

Serviço de LLM: responde dúvidas sobre adoção responsável com **RAG** e recomenda animais compatíveis usando uma **tool** do LangChain que consulta a busca de Animais. Trata o LLM como dependência falível (timeout, retry, circuit breaker, cache e fallback).

| | |
| --- | --- |
| **Stack** | Python + FastAPI + LangChain |
| **Porta interna** | `8003` |
| **Banco** | Qdrant (`qdrant-assistente`) + cache em `redis-assistente` |
| **Responsável** | Gabriel Nakazato |

Ainda não há código aqui. O esqueleto (`/health`, `/ready`, Dockerfile multi-stage) é criado na issue de esqueleto abaixo.

## Issues

- #24 — contrato OpenAPI
- #35 — ADR-007
- #42 — esqueleto e Dockerfile
- #49 — Kubernetes
- #66 — base de conhecimento e ingestão
- #67 — chain RAG
- #68 — tool e recomendação
- #69 — resiliência
- #70 — avaliação, latência e custo

A base de conhecimento fica em `kb/`, com a origem e a data de acesso de cada fonte.

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
