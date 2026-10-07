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
O Compose com PostgreSQL e as redes será conectado pela #37.

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
