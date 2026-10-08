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
pytest                                     # testes
ruff check . && ruff format --check .      # o mesmo lint da CI
```

O `--reload` serve só para o desenvolvimento e não vai para o Dockerfile.

## Estrutura

```text
services/animais/
├── app/
│   ├── main.py          # cria o FastAPI e registra as rotas
│   ├── config.py        # Settings: variáveis de ambiente com prefixo ANIMAIS_
│   └── api/
│       └── health.py    # GET /health (e o /ready da #39)
├── tests/
│   └── test_health.py   # exemplo de teste com TestClient
├── pyproject.toml       # configuração do ruff e do pytest
├── requirements.txt     # dependências da imagem, com versão fixada
└── requirements-dev.txt # + pytest, httpx e ruff
```

Rotas de negócio novas entram em `app/api/<recurso>.py`, com um `APIRouter` registrado em `main.py`. Acesso ao banco fica em `app/db.py`, e cada rota ganha um teste em `tests/`.

## O que já existe e o que falta na #39

A base acima só tem o `GET /health` e a configuração. O resto da #39 fica com o responsável. Os pontos marcados com `TODO(#39)` no código mostram onde mexer:

- [ ] `requirements.txt`: acrescentar `motor` e `python-json-logger`, com versão fixada.
- [ ] `config.py`: `ANIMAIS_MONGO_URL` e `ANIMAIS_LEITURA_MONGO_URL`, sem valor padrão.
- [ ] `app/db.py` e `lifespan` em `main.py`: conexão `motor` e criação dos índices, incluindo o `2dsphere`.
- [ ] `GET /ready` em `api/health.py`: `ping` no MongoDB, 503 quando ele cai, com um teste.
- [ ] Middleware de `X-Correlation-Id` e `X-Served-By` e logs em JSON.
- [ ] `Dockerfile` multi-stage, `Dockerfile.single` para comparar, e os tamanhos em `docs/imagens.md`.
- [ ] Bloco `animais` no `compose.yaml`, nas redes `services` e `data-animais`.

A CI já roda `ruff check` neste serviço. O `docker build` passa a rodar quando o `Dockerfile` existir.

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
