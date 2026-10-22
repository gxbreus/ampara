# Adoção

Solicitações de adoção **como o usuário as vê**: o pedido do adotante, a decisão do responsável, o cancelamento e a linha do tempo. Expõe a solicitação com **HATEOAS** (HAL). A SAGA é conduzida pelo [Orquestrador](../orquestrador) (ADR-008): a Adoção entrega as ações a ele por eventos e recebe de volta cada mudança de estado.

| | |
| --- | --- |
| **Stack** | Go |
| **Porta interna** | `8080` |
| **Banco** | PostgreSQL (`postgres-adocao`) |
| **Responsável** | Mateus Vitor |

## Rodar

```bash
docker compose up -d --build adocao   # sobe também o postgres-adocao e o RabbitMQ
go test ./...                          # testes, dentro de services/adocao
```

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /health` | — | 200 enquanto o processo está de pé |
| `GET /ready` | — | 200 se o PostgreSQL responde em até 2 s; 503 com *problem details* se não |
| `POST /v1/solicitacoes` | adotante | 202; publica `solicitacao.criada`, e o Orquestrador inicia a SAGA; aceita `Idempotency-Key` |
| `GET /v1/solicitacoes/{id}` | adotante, responsável ou ADMIN | a solicitação em HAL, com os links do estado e do papel |
| `GET /v1/solicitacoes` | filtro pelo próprio `sub` (ADMIN: qualquer) | lista paginada por cursor (`_embedded` + `_links.next`) |
| `GET /v1/solicitacoes/resumo` | o próprio responsável ou ADMIN | contadores para o painel da ONG |
| `GET /v1/solicitacoes/{id}/historico` | adotante, responsável ou ADMIN | a linha do tempo, em ordem |
| `POST /v1/solicitacoes/{id}/aprovacao` | responsável | 202; registra a decisão (o pivô) e publica `solicitacao.decidida` |
| `POST /v1/solicitacoes/{id}/recusa` | responsável | 202; o Orquestrador compensa e a solicitação chega a `RECUSADA` |
| `POST /v1/solicitacoes/{id}/cancelamento` | adotante | 202; o Orquestrador compensa e a solicitação chega a `CANCELADA` |

Ação em estado errado, ou depois de já haver uma decisão, responde 409, e ação de quem não pode responde 403. A resposta de uma decisão ainda mostra `AGUARDANDO_APROVACAO`, com o campo `decisao` preenchido e sem links de ação: o estado muda quando o `saga.transicao` do Orquestrador chega, em milissegundos. O contrato completo está em `docs/contratos/adocao.v1.yaml`.

**Operação (#86):** `POST /v1/solicitacoes/{id}/compensacao/retomada` (só ADMIN) publica `solicitacao.retomada`, e o Orquestrador retoma a SAGA parada no teto de reenvios. O alerta da DLQ registra cada mensagem que cai em `adocao.saga.dlq`. O roteiro completo está em [`docs/operacao/dlq.md`](../../docs/operacao/dlq.md).

- **Configuração:** só por variáveis de ambiente (`ADOCAO_DATABASE_URL`, `ADOCAO_AMQP_URL`, `ADOCAO_PORTA`, `JWT_PUBLIC_KEY`); o `compose.yaml` monta as URLs a partir do `.env`. Os prazos da SAGA são do Orquestrador (`ORQUESTRADOR_*`).
- **Migrations:** ficam em `internal/db/migrations/`, embutidas no binário com `go:embed`, e são aplicadas na subida.
- **Healthcheck:** a imagem final é distroless, sem shell nem `curl`, então o contêiner usa o subcomando `/adocao healthcheck`.
- **Logs:** JSON (`log/slog`), com `correlationId` em toda requisição. Toda resposta traz `X-Served-By` e `X-Correlation-Id`.

## Como a Adoção conversa com o Orquestrador

| Peça | Pacote | O que faz |
| --- | --- | --- |
| Repositório | `internal/repositorio` | grava a solicitação e a decisão e, na mesma transação, a mensagem `solicitacao.*` no outbox; mantém o espelho e a linha do tempo a partir de `saga.transicao` |
| Relay | `internal/outbox` | publica o outbox com `FOR UPDATE SKIP LOCKED` e *publisher confirms*; é o único `Publish` do serviço |
| Consumidor | `internal/consumidor` | lê `adocao.saga`, grava a inbox e aplica o `saga.transicao`, descartando versão antiga; `ack` só depois do commit |
| Estados | `internal/saga` | os nomes dos estados e das decisões; a máquina de estados fica no Orquestrador |
| API | `internal/httpapi` | rotas acima, com JWT RS256 verificado pela chave pública |

## Testes de integração

Os testes com banco e broker reais rodam quando as variáveis abaixo existem; sem elas, são pulados.

```bash
docker build -t ampara/rabbitmq:dev ../../infra/rabbitmq
docker run -d --name pg -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=adocao -p 127.0.0.1:55432:5432 postgres:16-alpine
docker run -d --name mq -p 127.0.0.1:55672:5672 \
  -e RABBITMQ_ADMIN_USER=admin -e RABBITMQ_ADMIN_PASSWORD=admin -e RABBITMQ_ADOCAO_PASSWORD=adocao \
  -e RABBITMQ_ORQUESTRADOR_PASSWORD=orquestrador -e RABBITMQ_ANIMAIS_PASSWORD=animais \
  -e RABBITMQ_IDENTIDADE_PASSWORD=identidade -e RABBITMQ_NOTIFICACOES_PASSWORD=x \
  ampara/rabbitmq:dev

export ADOCAO_TEST_DATABASE_URL="postgres://postgres:teste@127.0.0.1:55432/adocao?sslmode=disable"
export ADOCAO_TEST_AMQP_URL="amqp://adocao:adocao@127.0.0.1:55672/"
export ADOCAO_TEST_AMQP_ORQUESTRADOR_URL="amqp://orquestrador:orquestrador@127.0.0.1:55672/"
export ADOCAO_TEST_AMQP_ADMIN_URL="amqp://admin:admin@127.0.0.1:55672/"
go test -p 1 ./...
```

Os testes da SAGA (caminho feliz, compensações, participante fora do ar, réplicas e retomada) estão no [Orquestrador](../orquestrador). Aqui ficam os da solicitação: decisão única com duas ações simultâneas, idempotência do `POST`, espelho fora de ordem e consumidor com broker real.

## Issues

- #22 — contrato OpenAPI com HATEOAS
- #25 — catálogo de mensagens
- #26 — modelagem da SAGA
- #32 — outbox
- #40 — esqueleto e Dockerfile
- #48 — Kubernetes
- #58 — orquestrador da SAGA
- #59 — aprovar, recusar, cancelar e expirar
- #140 — SAGA extraída para o Orquestrador (ADR-008)

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
