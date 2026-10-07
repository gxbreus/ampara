# ADR 002: SAGA de adoção orquestrada por mensagens

- Status: aceita
- Data: 2026-10-07

## Contexto

Uma adoção atravessa três serviços com bancos próprios: Animais reserva e depois marca o animal como adotado, Identidade valida o perfil e controla a vaga de solicitação ativa, e Notificações avisa as pessoas envolvidas. Não existe transação distribuída entre eles, então cada passo precisa de uma compensação para quando um passo seguinte falhar.

O processo também tem uma espera humana de até 72 horas (a decisão do responsável) e precisa sobreviver à indisponibilidade temporária de um participante, que será provocada ao vivo na demonstração.

## Decisão

1. **Orquestração.** O serviço de Adoção é o orquestrador: guarda a máquina de estados da solicitação, decide o próximo passo e dispara as compensações. Animais e Identidade só executam comandos e respondem.
2. **Comandos e respostas pelo RabbitMQ.** O orquestrador envia comandos para `ampara.comandos` e recebe as respostas em `ampara.respostas`. Os comandos saem pelo outbox, gravados na mesma transação do estado.
3. **O pivô é a aprovação.** Antes dela, toda falha compensa os passos já feitos. Depois dela, os passos são retentáveis: são reenviados até dar certo, porque desfazer uma adoção aprovada não faz sentido para o negócio.

O modelo completo, com estados, transições e cenários de falha, está em [`docs/saga.md`](../saga.md).

## Alternativas consideradas

- **Coreografia.** Cada serviço reage aos eventos dos outros e publica os próprios: Animais reserva ao ver `adocao.solicitada`, Identidade valida ao ver `animal.reservado`, e assim por diante. Foi rejeitada porque o estado da adoção ficaria espalhado entre os serviços, as compensações dependeriam de cada um saber o que os outros já fizeram, e a espera humana com prazo não tem dono natural.
- **Orquestração por HTTP síncrono.** A Adoção chamaria Animais e Identidade diretamente. Foi rejeitada porque a SAGA pararia sempre que um participante estivesse fora do ar, o orquestrador teria que implementar sozinho a fila de novas tentativas, e o outbox não teria uso real.

| Critério | Orquestrada por mensagens (escolhida) | Coreografada | Orquestrada por HTTP |
| --- | --- | --- | --- |
| Acoplamento | participantes só conhecem os próprios comandos | cada serviço precisa conhecer os eventos dos outros | orquestrador depende da disponibilidade de cada participante |
| Visibilidade do estado | uma tabela na Adoção mostra onde cada SAGA está | estado espalhado; precisa juntar logs de vários serviços | uma tabela na Adoção |
| Complexidade | outbox, inbox e verificador de timeouts no orquestrador | lógica de compensação distribuída em todos os serviços | simples no caminho feliz; retries e timeouts feitos à mão |
| Participante fora do ar | o comando espera na fila e a SAGA compensa no timeout | o evento espera na fila, mas ninguém controla o prazo | a chamada falha na hora |
| Facilidade de demonstrar | a linha do tempo mostra cada transição e cada compensação | difícil mostrar quem decidiu compensar | fácil, mas não mostra resiliência |

## Consequências

- A Adoção fica mais complexa: precisa de outbox, inbox, verificador de timeouts e retomada ao reiniciar.
- Todos os participantes precisam ser idempotentes (inbox por `messageId`) e recusar ações que chegam depois de uma compensação (`sagas_compensadas`).
- A SAGA é eventualmente consistente: entre a solicitação e a reserva, o animal ainda aparece como disponível por alguns instantes.
- O catálogo de mensagens (`docs/contratos/eventos.md`) passa a ser contrato entre os serviços, versionado pela ADR-006.
