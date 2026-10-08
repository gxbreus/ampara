# Mensagem na DLQ e SAGA parada

Uma mensagem que falha 6 vezes seguidas (a entrega original e 5 devoluções), ou que chega inválida, vai para a DLQ da fila de origem. Nenhum serviço a reprocessa sozinho, porque isso recriaria o loop com a mensagem envenenada. Este roteiro mostra como identificar, corrigir e reprocessar.

## 1. Como aparece

| Sinal | Onde |
| --- | --- |
| log `ERROR` "mensagem na DLQ", com `messageId`, `tipo`, `sagaId`, `motivo` e `filaDeOrigem` | logs do serviço dono da fila (na Adoção, `adocao.respostas.dlq`) |
| log `CRITICAL` "passo esgotado: a solicitação requer intervenção", com `sagaId`, `passo` e `messageId` | logs da Adoção |
| solicitação parada em `COMPENSANDO` (ou `APROVADA`) com `requerIntervencao: true` | `GET /v1/solicitacoes?requerIntervencao=true`, com token de ADMIN |

Os dois costumam vir juntos: o participante não consegue processar um comando (por exemplo, `LiberarReserva`), o comando cai na DLQ e a Adoção, sem resposta, reenvia até o teto (`ADOCAO_MAX_REENVIOS_COMPENSACAO`) e para.

```bash
docker compose logs adocao | grep -E '"level":"(ERROR|CRITICAL)"'
kubectl -n ampara logs -l app=adocao | grep -E '"level":"(ERROR|CRITICAL)"'
```

## 2. Ver o que está na DLQ

O `scripts/dlq.sh` usa a API do painel do RabbitMQ com o usuário admin do `.env`. No Compose, o painel já está em `localhost:15672`. No Kubernetes, abra um túnel antes:

```bash
kubectl -n ampara port-forward svc/rabbitmq 15672 &
./scripts/dlq.sh listar animais.comandos.dlq
```

```text
animais.comandos.dlq: 1 mensagem(ns)
  0b8f6c2e-91d4-4a7b-8e13-5c2f9a0d4e61  LiberarReserva   saga=7f1c2a9e-…  motivo=delivery_limit  origem=animais.comandos  mortes=1
```

O `motivo` diz por que a mensagem morreu: `delivery_limit` (falhou 6 vezes) ou `rejected` (o consumidor a recusou por ser inválida).

## 3. Corrigir a causa

Leia o log de erro do consumidor para aquele `messageId`. Se o problema estiver no código, corrija e publique a versão nova antes de reprocessar. Se a mensagem estiver errada (formato inválido, versão desconhecida), não reprocesse: descarte-a no passo 4.

## 4. Reprocessar ou descartar

```bash
./scripts/dlq.sh reprocessar animais.comandos.dlq 0b8f6c2e-91d4-4a7b-8e13-5c2f9a0d4e61
./scripts/dlq.sh descartar   animais.comandos.dlq 0b8f6c2e-91d4-4a7b-8e13-5c2f9a0d4e61
```

O `reprocessar` devolve a mensagem para a fila de origem com o **mesmo** `messageId`; a inbox do consumidor garante que nada é aplicado duas vezes. O script esvazia a DLQ, trata a mensagem escolhida e republica as demais. Se ele falhar no meio, informa o arquivo de backup com tudo o que foi retirado.

## 5. Retomar a SAGA

Se a Adoção já tinha parado no teto, reprocessar a mensagem não basta: ela não reenvia mais nada por conta própria. Um ADMIN retoma a solicitação, e os passos esgotados são reenviados com o mesmo `messageId`:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN_ADMIN" \
  http://adocao:8080/v1/solicitacoes/7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17/compensacao/retomada
```

A resposta é 202, com `requerIntervencao: false`. Sem passo esgotado, a resposta é 409.

## 6. Conferir

```bash
curl -H "Authorization: Bearer $TOKEN_ADMIN" http://adocao:8080/v1/solicitacoes/7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17/historico
```

A linha do tempo mostra a retomada e, logo depois, a resposta do participante levando a solicitação ao estado final (por exemplo, `COMPENSANDO -> RECUSADA`). `./scripts/dlq.sh listar` deve mostrar a DLQ vazia.
