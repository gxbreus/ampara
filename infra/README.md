# Infraestrutura compartilhada

Imagens próprias da infraestrutura que precisa de customização:

| Pasta | Conteúdo | Issue |
| --- | --- | --- |
| `mongo/` | MongoDB em replica set de 1 nó (`rs0`) com keyFile gerado no volume na primeira subida; necessário para as transações do outbox de Animais | #37, #47 |
| `rabbitmq/` | RabbitMQ com `definitions.json` (exchanges, quorum queues, DLQs e bindings do [catálogo](../docs/contratos/eventos.md)) e um entrypoint que cria um usuário por serviço com permissões mínimas | #37, #48, #89 |

## Subir localmente

```bash
cp .env.example .env
./scripts/gerar-chaves-jwt.sh   # par RS256 do JWT
# preencha usuários e senhas no .env
docker compose up -d --build
docker compose ps               # todos os bancos e o RabbitMQ devem ficar "healthy"
```

O painel do RabbitMQ fica em http://localhost:15672, com o usuário `RABBITMQ_ADMIN_USER`.

## Por que o RabbitMQ tem um entrypoint

O `definitions.json` só traz a topologia, porque senha não pode ir para o repositório. O `rabbitmq/entrypoint.sh` sobe o broker e cria, a partir do `.env`, o usuário admin e os usuários `adocao`, `animais`, `identidade` e `notificacoes`, cada um com permissão só para o que publica e consome (catálogo, seção 7). O healthcheck só fica verde depois disso, então quem depende do RabbitMQ com `service_healthy` já encontra os usuários criados.

Nenhum usuário de serviço tem permissão `configure`: os serviços não declaram exchanges nem filas. Uma declaração passiva (`passive=True`), para conferir que a fila existe, é permitida.
