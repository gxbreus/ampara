# ADR 003: Outbox transacional e inbox para publicar mensagens

- Status: aceita
- Data: 2026-10-07

## Contexto

Três serviços gravam no próprio banco e precisam avisar outros serviços pelo RabbitMQ:

- a Adoção grava o estado da SAGA e publica o próximo comando;
- Animais grava o animal e publica `animal.*` para a projeção de busca;
- a Identidade verifica uma conta e publica `conta.verificada`.

Banco e broker não participam da mesma transação. Gravar e publicar em sequência abre uma janela em que o processo pode cair entre as duas operações. Na Adoção, essa janela deixa uma solicitação parada para sempre, ou um animal reservado sem solicitação. Além disso, o RabbitMQ entrega pelo menos uma vez, então qualquer consumidor pode receber a mesma mensagem duas vezes.

## Decisão

1. **Outbox transacional nos produtores.** A mensagem é gravada numa tabela (ou coleção) `outbox`, na mesma transação da mudança de estado. Um relay publica as linhas pendentes com *publisher confirms* e marca `publicado_em`. Vale para Adoção (PostgreSQL), Animais (MongoDB em replica set `rs0`) e Identidade (PostgreSQL).
2. **Inbox nos consumidores.** Cada consumidor registra o `messageId` na mesma transação do efeito e descarta mensagens repetidas.
3. **Respostas da SAGA sem outbox.** Os participantes gravam a resposta pronta na inbox, junto com o efeito, publicam depois do commit e só então fazem o `ack`. Se a mensagem voltar, republicam a mesma resposta.
4. **Relay por *polling*** com `FOR UPDATE SKIP LOCKED` no PostgreSQL, para permitir mais de uma réplica.

Os detalhes (tabelas, relay, análise de cada queda) estão em [`docs/dados.md`](../dados.md), seção 5.

## Alternativas consideradas

### Gravar e depois publicar, sem outbox

O serviço faz o commit e publica logo em seguida. É o mais simples, mas uma queda entre as duas operações perde a mensagem: o estado muda e ninguém fica sabendo. Na SAGA isso deixa o animal reservado sem que a Adoção avance. Rejeitada.

### Publicar e depois gravar

Publica primeiro e grava depois. Uma queda depois do publish deixa no broker uma mensagem sobre algo que nunca foi gravado, e o consumidor age sobre um estado que não existe. Rejeitada.

### Transação distribuída (2PC / XA)

Coordenaria banco e broker numa transação só. O RabbitMQ não oferece XA, o MongoDB também não, e um coordenador de 2PC bloqueia todos os participantes quando um deles cai. Rejeitada.

### Captura de mudanças do banco (CDC, com Debezium)

Um conector lê o log do banco (WAL do PostgreSQL ou *change stream* do MongoDB) e publica os eventos. Elimina o relay e o *polling*, mas exige subir Kafka Connect e Debezium, configurar a replicação lógica do PostgreSQL e operar mais três componentes no cluster local. Para o volume da Ampara, o custo de operação não se paga. Fica como evolução possível.

| Critério | Outbox + relay (escolhida) | Gravar e publicar | CDC (Debezium) |
| --- | --- | --- | --- |
| Perde mensagem se o processo cair | não | sim | não |
| Componentes novos | nenhum além de uma tabela | nenhum | Kafka Connect, Debezium, configuração de replicação |
| Latência até publicar | até o intervalo do relay (200 ms a 1 s) | imediata | baixa |
| Funciona com várias réplicas | sim, com `SKIP LOCKED` | sim | sim |
| Facilidade de demonstrar | alta: dá para ver a linha pendente e depois publicada | — | média |

## Consequências

- Nenhuma mensagem se perde por queda do processo ou do broker: a linha fica pendente até ser confirmada.
- Toda mensagem pode chegar mais de uma vez, então todo consumidor precisa de inbox ou de operação idempotente (o upsert por `version` da projeção).
- Há uma latência de até um intervalo do relay entre o commit e a publicação, que entra na defasagem aceitável da projeção (p95 ≤ 5 s).
- O MongoDB de Animais precisa rodar em replica set, mesmo com um nó só, e a imagem `infra/mongo/` precisa gerar o *keyFile*.
- As tabelas `outbox` e `inbox` crescem e precisam de limpeza: job diário no PostgreSQL e índice TTL no MongoDB.
