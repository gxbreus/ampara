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
Para rodar o serviço, forneça `NOTIFICACOES_REDIS_URL`, `NOTIFICACOES_AMQP_URL`
e a chave `JWT_PUBLIC_KEY` do mesmo ambiente da Identidade. O Compose e os
manifests Kubernetes já repassam a chave pública.

## Estrutura

```text
services/notificacoes/
├── app/
│   ├── main.py          # create_app() e o lifespan, único lugar que abre conexões
│   ├── config.py        # Settings: variáveis de ambiente com prefixo NOTIFICACOES_
│   ├── dependencias.py  # o que as rotas recebem por Depends (config, Redis, usuário)
│   ├── consumidor.py    # consumo de eventos e alerta operacional da DLQ
│   ├── eventos.py       # validação do envelope, destinatários e textos
│   ├── caixa.py         # persistência, paginação e marcação no Redis
│   └── api/
│       ├── health.py    # GET /health e GET /ready
│       └── notificacoes.py  # listagem e marcações de leitura
├── tests/               # testes unitários, HTTP e integração
├── pyproject.toml       # ruff e pytest
├── requirements.txt     # dependências da imagem, com versão fixada
└── requirements-dev.txt # + pytest, pytest-asyncio, httpx e ruff
```

## Consumo e caixa in-app

O consumidor usa a fila `notificacoes.eventos` definida pelo RabbitMQ. A confirmação
ocorre depois de gravar as notificações de todos os destinatários. A deduplicação por
evento e destinatário dura sete dias. A caixa guarda os 200 itens mais recentes pelo
`occurredAt` e mantém o contador de não lidas no Redis. O alerta registra as mensagens
da DLQ e as devolve à própria DLQ para intervenção pelo `scripts/dlq.sh`.

As três rotas autenticadas e os erros de resposta estão no
[contrato de Notificações](../../docs/contratos/notificacoes.v1.yaml). Cada caixa é
identificada pelo `sub` do JWT RS256 de Identidade.

## Testes

| Tipo | Onde | Como |
| --- | --- | --- |
| Domínio | `tests/test_eventos.py` | textos, destinatários e decisões de `nack` |
| API | `tests/test_api.py` | JWT, parâmetros e falha temporária do Redis |
| Integração | `tests/integracao/` | Redis e RabbitMQ reais, em um ambiente isolado de teste |

Teste `async def` roda direto, sem decorator (`asyncio_mode = "auto"`).

Defina `NOTIFICACOES_TEST_REDIS_URL` para executar os testes da caixa. Para incluir
o teste do consumidor, forneça também `NOTIFICACOES_TEST_AMQP_URL` (conta do serviço)
e `NOTIFICACOES_TEST_AMQP_ADMIN_URL` (conta que publica em `ampara.eventos`). O broker
de teste precisa ter importado `infra/rabbitmq/definitions.json`.

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
