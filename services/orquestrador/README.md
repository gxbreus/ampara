# Orquestrador

**Orquestrador da SAGA de adoção** (ADR-008): máquina de estados persistida, outbox para comandos e eventos, inbox para respostas, timeouts, reenvios, compensações e retomada. Não tem rotas de negócio: tudo o que move a SAGA chega e sai pelo RabbitMQ.

| | |
| --- | --- |
| **Stack** | Go |
| **Porta interna** | `8081` (só `/health` e `/ready`) |
| **Banco** | PostgreSQL (`postgres-orquestrador`) |
| **Responsável** | Mateus Vitor |

## Rodar

```bash
docker compose up -d --build orquestrador   # sobe também o postgres-orquestrador e o RabbitMQ
go test ./...                                # testes, dentro de services/orquestrador
```

## O que entra e o que sai

| Fila / exchange | Direção | Mensagens |
| --- | --- | --- |
| `orquestrador.solicitacoes` (`ampara.eventos`, `solicitacao.*`) | entra, vinda da Adoção | `solicitacao.criada` inicia a SAGA; `solicitacao.decidida` (`APROVADA`, `RECUSADA`, `CANCELADA`) é a decisão humana; `solicitacao.retomada` retoma passos esgotados (#86) |
| `orquestrador.respostas` (`ampara.respostas`, `orquestrador`) | entra, vinda dos participantes | `AnimalReservado`, `PerfilValidado`, `ReservaLiberada`, ... |
| `ampara.comandos` | sai | `ReservarAnimal`, `ValidarPerfil`, `ConfirmarAdocao`, `RegistrarAdocao`, `LiberarReserva`, `LiberarVaga` |
| `ampara.eventos` | sai | `adocao.*` para Notificações e os BFFs; `saga.transicao` para a Adoção, a cada transição, com `versao` crescente |

Uma decisão que chega depois da expiração (a corrida é resolvida com a SAGA travada) recebe `ack` e só um aviso no log: a Adoção já mostra o estado real pelo `saga.transicao`.

## Como a SAGA roda aqui

| Peça | Pacote | O que faz |
| --- | --- | --- |
| Máquina de estados | `internal/saga` | `Transicao(saga, evento, regras)`: função pura com as 18 transições de `docs/saga.md` |
| Repositório | `internal/repositorio` | trava a SAGA (`FOR UPDATE`), chama a máquina e grava estado, passos, histórico, outbox e o `saga.transicao` numa transação só |
| Relay | `internal/outbox` | publica o outbox com `FOR UPDATE SKIP LOCKED` e *publisher confirms*; é o único `Publish` do serviço |
| Consumidores | `internal/consumidor` | um por fila; gravam a inbox e aplicam a transição; `ack` só depois do commit. O alerta da DLQ espia as duas DLQs |
| Verificador | `internal/prazos` | a cada 1 s, aplica timeouts de passo e a expiração; também retoma o que travou num reinício |
| Saúde | `internal/httpapi` | `/health` (processo) e `/ready` (PostgreSQL) |

- **Configuração:** só por variáveis de ambiente: `ORQUESTRADOR_DATABASE_URL`, `ORQUESTRADOR_AMQP_URL`, `ORQUESTRADOR_PORTA`, `ORQUESTRADOR_TIMEOUT_PASSO` (10 s), `ORQUESTRADOR_PRAZO_EXPIRACAO` (72 h; 2 min na demo) e `ORQUESTRADOR_MAX_REENVIOS_COMPENSACAO` (10).
- **Migrations:** em `internal/db/migrations/`, embutidas no binário com `go:embed` e aplicadas na subida.
- **Healthcheck:** a imagem final é distroless, sem shell nem `curl`, então o contêiner usa o subcomando `/orquestrador healthcheck`.
- **Logs:** JSON (`log/slog`), com `sagaId`, `messageId` e `correlationId` em cada mensagem. Passo esgotado sai com nível `CRITICAL`.

## Testes de integração

Os testes com banco e broker reais rodam quando as variáveis abaixo existem; sem elas, são pulados.

```bash
docker build -t ampara/rabbitmq:dev ../../infra/rabbitmq
docker run -d --name pg -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=orquestrador -p 127.0.0.1:55432:5432 postgres:16-alpine
docker run -d --name mq -p 127.0.0.1:55672:5672 \
  -e RABBITMQ_ADMIN_USER=admin -e RABBITMQ_ADMIN_PASSWORD=admin -e RABBITMQ_ORQUESTRADOR_PASSWORD=orquestrador \
  -e RABBITMQ_ADOCAO_PASSWORD=adocao -e RABBITMQ_ANIMAIS_PASSWORD=animais \
  -e RABBITMQ_IDENTIDADE_PASSWORD=identidade -e RABBITMQ_NOTIFICACOES_PASSWORD=x \
  ampara/rabbitmq:dev

export ORQUESTRADOR_TEST_DATABASE_URL="postgres://postgres:teste@127.0.0.1:55432/orquestrador?sslmode=disable"
export ORQUESTRADOR_TEST_AMQP_URL="amqp://orquestrador:orquestrador@127.0.0.1:55672/"
export ORQUESTRADOR_TEST_AMQP_ANIMAIS_URL="amqp://animais:animais@127.0.0.1:55672/"
export ORQUESTRADOR_TEST_AMQP_ADMIN_URL="amqp://admin:admin@127.0.0.1:55672/"
go test -p 1 ./...
```

`internal/integracao` roda o Orquestrador inteiro, com a Adoção simulada publicando `solicitacao.*` e participantes simulados: caminho feliz até `CONCLUIDA` (conferindo os `saga.transicao` que a Adoção recebe), perfil incompleto, animal já reservado, Identidade fora do ar, recusa, compensação com o participante fora do ar, duas réplicas e o teto de reenvios com retomada. Para provocar os mesmos cenários no Compose, use `scripts/demo/participantes_falsos.py`.

## Issues

- #138 — ADR-008: Orquestrador separado da Adoção
- #140 — extração da SAGA para este serviço
- #26, #58, #59, #86 — modelagem e implementação originais da SAGA, feitas na Adoção

## Regras que valem para todo serviço

- Lê configuração só de variáveis de ambiente; nenhuma credencial no código.
- Expõe `GET /health` e `GET /ready`, loga em JSON e responde com `X-Served-By`.
- Não tem rota externa nem é chamado por HTTP: tudo passa pelo RabbitMQ.
- Só acessa o próprio banco. Dado de outro serviço chega por mensagem.
