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

- [x] `requirements.txt`: acrescentar `pymongo` e `python-json-logger`, com versão fixada.
- [x] `config.py`: `ANIMAIS_MONGO_URL` e `ANIMAIS_LEITURA_MONGO_URL` como `SecretStr`, sem valor padrão.
- [x] `app/db.py` e o `lifespan` em `main.py`: `AsyncMongoClient` e criação dos índices, incluindo o `2dsphere`.
- [x] `GET /ready` em `api/health.py`: `ping` no MongoDB, 503 quando ele cai, com um teste.
- [x] Middleware de `X-Correlation-Id` e `X-Served-By` e logs em JSON.
- [x] `Dockerfile` multi-stage, `Dockerfile.single` para comparar, e os tamanhos em `docs/imagens.md`.
- [x] Bloco `animais` no `compose.yaml`, nas redes `services` e `data-animais`.

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

## Busca CQRS (#56)

`GET /v1/animais/busca?lat=-21.2468&lng=-44.9998&raioKm=10` é público.
O cursor fica vinculado aos filtros e desempata distâncias pelo ID; uma mudança
no catálogo entre páginas pode alterar a lista (consistência eventual).
`GET /v1/animais/busca/{id}` também mostra reservados e adotados, sem coordenadas.

O worker consome `animais.projecao` sem declarar topologia e ignora snapshots
antigos. `ANIMAIS_AMQP_URL` configura o broker. Conta verificada alimenta a réplica
local e todos os animais do responsável. Snapshots antigos sem os novos campos
opcionais de detalhe exigem reconstrução.

Com escritores e consumidor parados, execute na pasta do serviço:
`python scripts/reconstruir_projecao.py --confirmar`.
O script limpa somente `animais_leitura.animais_busca` e reprojeta a escrita.

Em ambiente de demonstração, defina `DEMO_TOKEN_RESPONSAVEL` e rode
`python scripts/medir_defasagem.py --entrada animal.json --url http://localhost:8001`.
O JSON segue NovoAnimalEntrada; o script cadastra 50 animais e falha se p95 > 5 s.
Em 17/11/2026, os testes de integração passaram contra MongoDB 7.0.14 em replica
set local isolado: raio/ordenação/cursor, privacidade, versões, responsável e
reconstrução com conteúdo idêntico. Defina `ANIMAIS_TEST_MONGO_URL` para executá-los.
A medição de latência com 50 cadastros/1.000 animais e a integração com RabbitMQ
continuam pendentes; estes resultados não foram estimados.

## Participante da SAGA (#57)

O worker lê animais.comandos e publica respostas em ampara.respostas com routing
key orquestrador. Efeito, inbox e evento do outbox são transacionais; a resposta
é confirmada pelo broker antes do ACK. A marca de compensação impede reserva
tardia. Edições HTTP usam versão esperada para preservar reservas concorrentes.

Em 17/11/2026, 48 testes passaram, incluindo MongoDB 7.0.14 real: 20 reservas
simultâneas, resposta idempotente, compensação precautória, confirmação, rollback
e conflito de edição manual. Integração completa com RabbitMQ/serviços ainda pendente.
