# Assistente

Serviço de LLM: responde dúvidas sobre adoção responsável com **RAG** e recomenda animais compatíveis usando uma **tool** do LangChain que consulta a busca de Animais. Trata o LLM como dependência falível (timeout, retry, circuit breaker, cache e fallback).

| | |
| --- | --- |
| **Stack** | Python + FastAPI + LangChain |
| **Porta interna** | `8003` |
| **Banco** | Qdrant (`qdrant-assistente`) + cache em `redis-assistente` |
| **Responsável** | Gabriel Nakazato |

## Rodar localmente

Precisa de Python 3.12. Não é preciso ter a chave do LLM. Dentro de `services/assistente`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

uvicorn app.main:app --reload --port 8003   # http://localhost:8003/health e /docs
pytest                                      # testes
ruff check . && ruff format --check .       # o mesmo lint da CI
```

O `--reload` serve só para o desenvolvimento e não vai para o Dockerfile.

## Estrutura

Hoje:

```text
services/assistente/
├── app/
│   ├── main.py          # create_app() e o lifespan, único lugar que abre conexões
│   ├── config.py        # Settings: LLM_*, QDRANT_URL e ASSISTENTE_REDIS_URL
│   ├── dependencias.py  # o que as rotas recebem por Depends (config, Qdrant, LLM)
│   └── api/
│       └── health.py    # GET /health (e o /ready da #42)
├── tests/
│   ├── conftest.py      # fixture `cliente`: o app sem abrir conexões
│   └── test_health.py
├── pyproject.toml       # ruff e pytest
├── requirements.txt     # dependências da imagem, com versão fixada
└── requirements-dev.txt # + pytest, pytest-asyncio, httpx e ruff
```

O que chega depois, e em qual issue:

```text
services/assistente/
├── kb/                     # #66: textos da base de conhecimento, com fonte e data de acesso
└── app/
    ├── ingestao/           # #66: lê kb/, gera embeddings e grava no Qdrant (roda à parte)
    ├── api/assistente.py   # #67 e #68: rotas /v1 de pergunta e recomendação
    ├── llm/                # #67 e #69: cliente do provedor, timeout, retry e fallback
    ├── rag/                # #67: busca no Qdrant e montagem do prompt
    ├── agente/             # #68: a tool que consulta a busca do Animais
    ├── clientes/animais.py # #68: chamada HTTP ao Animais (httpx.AsyncClient)
    └── cache.py            # #69: cache das respostas no redis-assistente
```

## Regras de ouro

1. **Nada abre conexão no import.** Qdrant, Redis e o `httpx.AsyncClient` do Animais são abertos no `lifespan`, guardados em `app.state` e entregues às rotas por `Depends` (`app/dependencias.py`).
2. **O serviço sobe sem a chave do LLM.** `LLM_API_KEY` vazia é modo degradado: o `/ready` responde 200 e as respostas usam o fallback. O cliente do LLM é criado sob demanda, nunca no import.
3. **O `/ready` nunca chama o LLM.** Verifica só o Qdrant e o Redis.
4. **Tudo é async.** Use `AsyncQdrantClient`, `redis.asyncio`, `httpx.AsyncClient` e, no LangChain, `ainvoke` em vez de `invoke`. O ruff bloqueia `QdrantClient`, `redis.Redis`, `requests` e `time.sleep` dentro de `async def`.
5. **Nenhum teste chama o provedor de verdade.** O LLM é trocado por um falso com `app.dependency_overrides`.
6. **Dado de animal vem da API do Animais**, pela tool da #68, nunca do banco dele.

## Testes

| Tipo | Onde | Como |
| --- | --- | --- |
| Unidade | `tests/` | prompt, cache e fallback com o LLM falso, sem rede |
| API | `tests/` | fixture `cliente`; LLM, Qdrant e Animais trocados com `app.dependency_overrides` |
| Integração | `tests/integracao/` | Qdrant de verdade; o teste é pulado (`pytest.skip`) quando `ASSISTENTE_TEST_QDRANT_URL` não está definida |

Teste `async def` roda direto, sem decorator (`asyncio_mode = "auto"`). A avaliação das respostas com o LLM real é a #70, fora do `pytest`.

## O que já existe e o que falta na #42

A base acima só tem o `GET /health` e a configuração. O resto da #42 fica com o responsável. Os pontos marcados com `TODO(#42)` no código mostram onde mexer:

- [ ] `requirements.txt`: acrescentar `langchain`, `langchain-qdrant`, `qdrant-client`, `redis`, `httpx`, `python-json-logger` e o pacote do provedor, com versão fixada.
- [ ] `config.py`: os campos com os nomes do `.env.example` (o molde está no comentário).
- [ ] `lifespan` em `main.py`: `AsyncQdrantClient`, `redis.asyncio` e o `httpx.AsyncClient` do Animais.
- [ ] `GET /ready` em `api/health.py`: Qdrant e Redis, 503 quando um deles cai, 200 com a chave do LLM vazia, com teste.
- [ ] Middleware de `X-Correlation-Id` e `X-Served-By` e logs em JSON.
- [ ] `Dockerfile` multi-stage, com o `build-essential` só na etapa de build se for preciso, e os tamanhos em `docs/imagens.md`.
- [ ] Bloco `assistente` no `compose.yaml`, nas redes `services` e `data-assistente`.

A CI instala o `requirements-dev.txt` e roda `ruff check`, `ruff format --check` e `pytest` neste serviço (depois do merge do #126). O `docker build` passa a rodar quando o `Dockerfile` existir.

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
