# Adoção

Solicitações de adoção e **orquestrador da SAGA**: máquina de estados persistida, outbox para comandos e eventos, inbox para respostas, timeouts e retomada. Expõe a solicitação com **HATEOAS** (HAL).

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

| Rota | O que faz |
| --- | --- |
| `GET /health` | 200 enquanto o processo está de pé |
| `GET /ready` | 200 se o PostgreSQL responde em até 2 s; 503 com *problem details* se não |

- **Configuração:** só por variáveis de ambiente (`ADOCAO_DATABASE_URL`, `ADOCAO_PORTA`); o `compose.yaml` monta a URL do banco a partir do `.env`.
- **Migrations:** ficam em `internal/db/migrations/`, embutidas no binário com `go:embed`, e são aplicadas na subida.
- **Healthcheck:** a imagem final é distroless, sem shell nem `curl`, então o contêiner usa o subcomando `/adocao healthcheck`.
- **Logs:** JSON (`log/slog`), com `correlationId` em toda requisição. Toda resposta traz `X-Served-By` e `X-Correlation-Id`.

## Como a SAGA roda aqui

| Peça | Pacote | O que faz |
| --- | --- | --- |
| Máquina de estados | `internal/saga` | `Transicao(solicitacao, evento, regras)`: função pura com as 18 transições de `docs/saga.md` |
| Repositório | `internal/repositorio` | trava a solicitação (`FOR UPDATE`), chama a máquina e grava estado, passos, histórico e outbox numa transação só |
| Relay | `internal/outbox` | publica o outbox com `FOR UPDATE SKIP LOCKED` e *publisher confirms*; é o único `Publish` do serviço |
| Consumidor | `internal/consumidor` | lê `adocao.respostas`, grava a inbox e aplica a transição; `ack` só depois do commit |
| Verificador | `internal/prazos` | a cada 1 s, aplica timeouts de passo e a expiração; também retoma o que travou num reinício |
| API | `internal/httpapi` | `POST /v1/solicitacoes` (202, `Idempotency-Key`), com JWT RS256 verificado pela chave pública |

## Testes de integração

Os testes com banco e broker reais rodam quando as variáveis abaixo existem; sem elas, são pulados.

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=adocao -p 127.0.0.1:55432:5432 postgres:16-alpine
docker run -d --name mq -p 127.0.0.1:55672:5672 \
  -e RABBITMQ_ADMIN_USER=admin -e RABBITMQ_ADMIN_PASSWORD=admin -e RABBITMQ_ADOCAO_PASSWORD=adocao \
  -e RABBITMQ_ANIMAIS_PASSWORD=animais -e RABBITMQ_IDENTIDADE_PASSWORD=identidade -e RABBITMQ_NOTIFICACOES_PASSWORD=x \
  ampara/rabbitmq:dev

export ADOCAO_TEST_DATABASE_URL="postgres://postgres:teste@127.0.0.1:55432/adocao?sslmode=disable"
export ADOCAO_TEST_AMQP_URL="amqp://adocao:adocao@127.0.0.1:55672/"
export ADOCAO_TEST_AMQP_ANIMAIS_URL="amqp://animais:animais@127.0.0.1:55672/"
export ADOCAO_TEST_AMQP_ADMIN_URL="amqp://admin:admin@127.0.0.1:55672/"
go test -p 1 ./...
```

`internal/integracao` roda o orquestrador inteiro contra participantes simulados: caminho feliz até `CONCLUIDA`, perfil incompleto, animal já reservado, Identidade fora do ar, recusa, compensação com o participante fora do ar e duas réplicas. Para provocar os mesmos cenários no Compose, use `scripts/demo/participantes_falsos.py`.

## Issues

- #22 — contrato OpenAPI com HATEOAS
- #25 — catálogo de mensagens
- #26 — modelagem da SAGA
- #32 — outbox
- #40 — esqueleto e Dockerfile
- #48 — Kubernetes
- #58 — orquestrador da SAGA
- #59 — aprovar, recusar, cancelar e expirar

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON com `correlationId` e responde com `X-Served-By`.
- Rotas internas começam com `/v1` e nunca ficam expostas fora do cluster: o acesso externo passa pelo gateway e pelos BFFs.
- Só acessa o próprio banco. Dado de outro serviço chega por chamada HTTP interna ou por mensagem no RabbitMQ.
