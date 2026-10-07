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
