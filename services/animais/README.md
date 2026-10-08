# Animais

Catálogo de animais (fotos, status, localização) e reserva durante a SAGA. Aplica **CQRS**: escrita no database `animais` e busca geográfica servida pela projeção `animais_leitura.animais_busca`.

| | |
| --- | --- |
| **Stack** | Python + FastAPI |
| **Porta interna** | `8001` |
| **Banco** | MongoDB em replica set (`mongo-animais`) |
| **Responsável** | Gabriel Cantanhede |

## Rodar localmente

Precisa de Python 3.12. Dentro de `services/animais`:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

uvicorn app.main:app --reload --port 8001   # http://localhost:8001/health e /docs
pytest                                      # testes
ruff check . && ruff format --check .       # o mesmo lint da CI
```

O `--reload` serve só para o desenvolvimento e não vai para o Dockerfile.

## Estrutura

Hoje:

```text
services/animais/
├── app/
│   ├── main.py          # create_app() e o lifespan, único lugar que abre conexões
│   ├── config.py        # Settings: variáveis de ambiente com prefixo ANIMAIS_
│   ├── dependencias.py  # o que as rotas recebem por Depends (config, bancos)
│   └── api/
│       └── health.py    # GET /health (e o /ready da #39)
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
├── db.py                # #39: abre o MongoDB e cria os índices, nada de regra de negócio
├── api/animais.py       # #55 e #56: rotas /v1/animais
├── dominio/             # #55: regras puras (status, reserva), sem FastAPI nem banco
├── repositorio/         # #55: escrita e leitura no MongoDB
├── outbox_relay.py      # #55: publica os eventos da outbox no RabbitMQ
├── projetor.py          # #56: consome os eventos e atualiza animais_leitura
└── saga.py              # #57: reserva e liberação pedidas pela Adoção
```

## Regras de ouro

1. **Nada abre conexão no import.** Banco, RabbitMQ e clientes HTTP são abertos no `lifespan`, guardados em `app.state` e entregues às rotas por `Depends` (`app/dependencias.py`).
2. **Tudo é async.** Use `pymongo.AsyncMongoClient` (o `motor` foi descontinuado em 14/05/2026) e `httpx.AsyncClient`. O ruff bloqueia `pymongo.MongoClient`, `motor`, `requests` e `time.sleep` dentro de `async def`.
3. **`get_settings()` só no lifespan e em `Depends`.** URL com senha é `SecretStr` sem valor padrão.
4. **O domínio não conhece o FastAPI nem o banco.** Assim ele é testado sem subir nada.

## Testes

| Tipo | Onde | Como |
| --- | --- | --- |
| Domínio | `tests/dominio/` | funções puras, sem app e sem banco |
| API | `tests/` | fixture `cliente`; o banco é trocado com `app.dependency_overrides` |
| Integração | `tests/integracao/` | MongoDB de verdade; o teste é pulado (`pytest.skip`) quando `ANIMAIS_TEST_MONGO_URL` não está definida |

Teste `async def` roda direto, sem decorator (`asyncio_mode = "auto"`).

## O que já existe e o que falta na #39

A base acima só tem o `GET /health` e a configuração. O resto da #39 fica com o responsável. Os pontos marcados com `TODO(#39)` no código mostram onde mexer:

- [ ] `requirements.txt`: acrescentar `pymongo` e `python-json-logger`, com versão fixada.
- [ ] `config.py`: `ANIMAIS_MONGO_URL` e `ANIMAIS_LEITURA_MONGO_URL` como `SecretStr`, sem valor padrão.
- [ ] `app/db.py` e o `lifespan` em `main.py`: `AsyncMongoClient` e criação dos índices, incluindo o `2dsphere`.
- [ ] `GET /ready` em `api/health.py`: `ping` no MongoDB, 503 quando ele cai, com um teste.
- [ ] Middleware de `X-Correlation-Id` e `X-Served-By` e logs em JSON.
- [ ] `Dockerfile` multi-stage, `Dockerfile.single` para comparar, e os tamanhos em `docs/imagens.md`.
- [ ] Bloco `animais` no `compose.yaml`, nas redes `services` e `data-animais`.

A CI instala o `requirements-dev.txt` e roda `ruff check`, `ruff format --check` e `pytest` neste serviço. O `docker build` passa a rodar quando o `Dockerfile` existir.

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
