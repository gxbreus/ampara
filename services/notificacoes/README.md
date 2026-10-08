# Notificações

Consome os eventos de adoção e de conta e mantém a caixa de notificações de cada usuário. Consumidor idempotente; nunca altera o resultado de uma adoção.

| | |
| --- | --- |
| **Stack** | Python + FastAPI |
| **Porta interna** | `8002` |
| **Banco** | Redis com AOF (`redis-notificacoes`) |
| **Responsável** | Gabriel Nakazato |

## Rodar localmente

Precisa de Python 3.12. Dentro de `services/notificacoes`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

uvicorn app.main:app --reload --port 8002   # http://localhost:8002/health e /docs
pytest                                      # testes
ruff check . && ruff format --check .       # o mesmo lint da CI
```

O `--reload` serve só para o desenvolvimento e não vai para o Dockerfile.

## Estrutura

Hoje:

```text
services/notificacoes/
├── app/
│   ├── main.py          # create_app() e o lifespan, único lugar que abre conexões
│   ├── config.py        # Settings: variáveis de ambiente com prefixo NOTIFICACOES_
│   ├── dependencias.py  # o que as rotas recebem por Depends (config, Redis, usuário)
│   └── api/
│       └── health.py    # GET /health (e o /ready da #41)
├── tests/
│   ├── conftest.py      # fixture `cliente`: o app sem abrir conexões
│   └── test_health.py
├── pyproject.toml       # ruff e pytest
├── requirements.txt     # dependências da imagem, com versão fixada
└── requirements-dev.txt # + pytest, pytest-asyncio, httpx e ruff
```

O que chega depois, e em qual issue:

```text
app/
├── redis.py             # #41: abre o Redis, nada de regra de negócio
├── mensageria.py        # #41: abre a conexão com o RabbitMQ (connect_robust)
├── api/notificacoes.py  # #60: /v1/notificacoes, leitura e leitura-todas
├── dominio/textos.py    # #60: evento → destinatários e texto, funções puras
├── caixa.py             # #60: caixa por usuário no Redis (ZADD, HSET, contador)
└── consumidor.py        # #60 e #86: fila notificacoes.eventos e log da DLQ
```

## Regras de ouro

1. **Nada abre conexão no import.** Redis e RabbitMQ são abertos no `lifespan`, guardados em `app.state` e entregues às rotas por `Depends` (`app/dependencias.py`). O consumidor da #60 é uma tarefa iniciada no mesmo `lifespan`.
2. **Tudo é async.** Use `redis.asyncio` e `aio_pika`. O ruff bloqueia `redis.Redis`, `pika`, `requests` e `time.sleep` dentro de `async def`.
3. **`get_settings()` só no lifespan e em `Depends`.** URL com senha é `SecretStr` sem valor padrão.
4. **O usuário vem do JWT, nunca de parâmetro.** Nenhuma rota recebe `usuarioId`.
5. **A fila não é declarada no código.** Ela já existe no `definitions.json` do RabbitMQ; o consumidor só a usa.
6. **Os textos não conhecem o Redis nem o RabbitMQ.** Assim a tabela evento → texto é testada sem subir nada.

## Testes

| Tipo | Onde | Como |
| --- | --- | --- |
| Domínio | `tests/dominio/` | funções puras (textos, destinatários), sem app e sem Redis |
| API | `tests/` | fixture `cliente`; o Redis e o usuário são trocados com `app.dependency_overrides` |
| Integração | `tests/integracao/` | Redis de verdade; o teste é pulado (`pytest.skip`) quando `NOTIFICACOES_TEST_REDIS_URL` não está definida |

Teste `async def` roda direto, sem decorator (`asyncio_mode = "auto"`).

## O que já existe e o que falta na #41

A base acima só tem o `GET /health` e a configuração. O resto da #41 fica com o responsável. Os pontos marcados com `TODO(#41)` no código mostram onde mexer:

- [ ] `requirements.txt`: acrescentar `redis`, `aio-pika` e `python-json-logger`, com versão fixada.
- [ ] `config.py`: `NOTIFICACOES_REDIS_URL` e `NOTIFICACOES_AMQP_URL` como `SecretStr`, sem valor padrão.
- [ ] `lifespan` em `main.py`: Redis com `redis.asyncio` e RabbitMQ com `aio_pika.connect_robust`.
- [ ] `GET /ready` em `api/health.py`: `PING` no Redis e conexão aberta com o RabbitMQ, 503 quando um deles cai, com teste.
- [ ] Middleware de `X-Correlation-Id` e `X-Served-By` e logs em JSON.
- [ ] `Dockerfile` multi-stage e os tamanhos em `docs/imagens.md`.
- [ ] Bloco `notificacoes` no `compose.yaml`, nas redes `services` e `data-notificacoes`, e a prova de persistência do Redis no PR.

A CI instala o `requirements-dev.txt` e roda `ruff check`, `ruff format --check` e `pytest` neste serviço (depois do merge do #126). O `docker build` passa a rodar quando o `Dockerfile` existir.

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
