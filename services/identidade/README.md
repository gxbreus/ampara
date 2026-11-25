# Identidade

Cadastro, autenticação (JWT RS256) e perfil de adoção de adotantes, protetores e ONGs; verificação de contas; participante da SAGA (validar perfil e controlar a vaga de solicitação ativa).

| | |
| --- | --- |
| **Stack** | Node.js + NestJS |
| **Porta interna** | `3001` |
| **Banco** | PostgreSQL (`postgres-identidade`) |
| **Responsável** | Gabriel Soares |

## Executar localmente

```bash
cp .env.example .env
npm install
npm run start:dev
```

`GET /health` apenas confirma que o processo está ativo. `GET /ready` consulta
o PostgreSQL e responde `503` enquanto o banco estiver indisponível. Toda
resposta inclui `X-Served-By` e `X-Correlation-Id`; os logs HTTP são emitidos
em JSON com esse identificador.

O serviço usa somente variáveis de ambiente. A primeira migration em
`src/migrations/` cria a tabela `contas`; `synchronize` permanece desativado.
A conexão vem de `IDENTIDADE_DATABASE_URL`, o mesmo nome do `.env.example` da raiz.

Toda resposta de erro sai em `application/problem+json`, no formato `Problema`
do contrato (`docs/contratos/identidade.v1.yaml`).

## Testes

```bash
npm test            # unitários e e2e (supertest); o e2e usa o pg-mem, sem infraestrutura
npm run test:e2e    # só os e2e
```

Com PostgreSQL e RabbitMQ reais, os e2e também cobrem o que o pg-mem não implementa
(`FOR UPDATE`, `= ANY($1::uuid[])`) e a publicação da outbox com o usuário
`identidade`. Cada execução cria e apaga um schema próprio no banco informado:

```bash
IDENTIDADE_TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/identidade \
IDENTIDADE_TEST_AMQP_URL=amqp://identidade:senha@localhost:5672/ \
IDENTIDADE_TEST_AMQP_ADMIN_URL=amqp://admin:senha@localhost:5672/ \
npm test
```

Os testes de idempotência da SAGA (mesmo `messageId` duas vezes) e de falha entre
o commit e a publicação da resposta rodam na CI com um dublê do banco
(`test/support/banco-saga-falso.ts`); com as variáveis acima, `test/e2e/saga.e2e-spec.ts`
repete os casos contra o PostgreSQL real e confere, no RabbitMQ, a resposta em
`orquestrador.respostas` e a ida direta para `identidade.comandos.dlq` de um comando
inválido. A parte do broker consome `identidade.comandos`: use um broker descartável.

## SAGA

O consumidor lê `identidade.comandos` (`ValidarPerfil`, `LiberarVaga`, `RegistrarAdocao`)
e responde em `ampara.respostas` com a routing key `orquestrador`, na ordem commit
(efeito + inbox) → publica com confirm → `ack`. Comando que não confere com o catálogo
(JSON quebrado, UUID inválido, `version` desconhecida) recebe `nack` sem requeue e vai
direto para a DLQ; erro temporário volta para a fila até o `x-delivery-limit`. Se a
conexão com o broker cair, o consumidor tenta de novo a cada 5 s.

Pelo Compose, na raiz do repositório:

```bash
docker compose up -d --build identidade   # sobe também o postgres-identidade
```

## Issues

- #20 — contrato OpenAPI
- #38 — esqueleto e Dockerfile
- #46 — Kubernetes
- #53 — contas, login e perfil
- #54 — participante da SAGA

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
