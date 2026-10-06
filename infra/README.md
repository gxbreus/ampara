# Infraestrutura compartilhada

Imagens próprias da infraestrutura que precisa de customização:

| Pasta | Conteúdo | Issue |
| --- | --- | --- |
| `mongo/` | MongoDB em replica set de 1 nó (`rs0`) com keyFile gerado na primeira subida; necessário para as transações do outbox de Animais | #37, #47 |
| `rabbitmq/` | RabbitMQ com `definitions.json`: exchanges `ampara.comandos`, `ampara.respostas`, `ampara.eventos` e `ampara.dlx`, quorum queues e DLQs | #37, #48 |

O `compose.yaml` fica na raiz do repositório (#37).
