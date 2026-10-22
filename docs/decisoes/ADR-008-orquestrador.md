# ADR 008: Orquestrador da SAGA separado da Adoção

- Status: aceita
- Data: 2026-10-22
- Substitui em parte: [ADR-002](ADR-002-saga-orquestrada.md), no ponto "o serviço de Adoção é o orquestrador"

## Contexto

A [ADR-002](ADR-002-saga-orquestrada.md) definiu a SAGA de adoção como orquestrada por mensagens e pôs o orquestrador dentro do serviço de Adoção. O código seguiu esse desenho: o mesmo processo atende as telas (criar, listar, aprovar e acompanhar solicitações) e conduz o processo distribuído (comandos, prazos, reenvios e compensações).

Na revisão da Parte 2, o professor apontou que a coordenação da SAGA deve ficar num microsserviço próprio. A divisão também resolve dois incômodos do desenho atual:

- **Duas razões para mudar no mesmo serviço.** A regra da solicitação muda com o produto: quem pode aprovar, o que aparece na linha do tempo, os filtros do painel. O controle do processo muda com a infraestrutura: timeouts, backoff, teto de reenvios, retomada.
- **Duas cargas no mesmo processo.** O painel da ONG e o app do adotante consultam solicitações o tempo todo, enquanto o verificador de prazos e o consumidor de respostas rodam em segundo plano. Uma sobrecarga num lado atrasa o outro, e não dá para escalar só uma das partes.

## Decisão

1. **O Orquestrador é um microsserviço próprio** (`services/orquestrador`, Go, banco `postgres-orquestrador`). Ele guarda a máquina de estados de cada SAGA, envia os comandos para `ampara.comandos`, recebe as respostas em `orquestrador.respostas`, controla os prazos (timeout de cada passo e as 72 h da decisão), reenvia o que ficou sem resposta, dispara as compensações e retoma as SAGAs em andamento quando reinicia. Não tem rotas de negócio: expõe só `/health` e `/ready`.
2. **A Adoção é dona do que o usuário vê:** a solicitação, a decisão do responsável, o cancelamento do adotante, a linha do tempo e a idempotência do `POST`. Ela valida as ações pelo estado que conhece e as entrega ao Orquestrador por eventos, sempre pelo outbox:
   - `solicitacao.criada`: inicia a SAGA;
   - `solicitacao.decidida`: aprovação (o pivô), recusa ou cancelamento;
   - `solicitacao.retomada`: um ADMIN retoma uma SAGA parada no teto de reenvios.
3. **O Orquestrador publica `saga.transicao` a cada mudança de estado.** O evento leva o estado, o desfecho, o motivo, o prazo, o passo, o número da transição e uma `versao` crescente por SAGA. A Adoção consome esse evento e mantém um espelho do estado e a linha do tempo, descartando versões antigas.
4. **Os eventos de negócio continuam `adocao.*`, publicados pelo Orquestrador.** Notificações e os BFFs consomem esses eventos sem mudança de nome nem de payload. O prefixo `solicitacao.*` fica para as mensagens da Adoção, e `saga.*` para o espelho, para que Notificações não receba o que não lhe interessa.
5. **As ações humanas ficam assíncronas de ponta a ponta.** Aprovar, recusar e cancelar já respondiam `202`. Agora a resposta significa "a decisão foi registrada e entregue ao Orquestrador". Se o prazo expirar no mesmo instante, o Orquestrador resolve a corrida com a SAGA travada (`FOR UPDATE`) e ignora a decisão que chegou tarde. A Adoção passa a mostrar o estado real assim que recebe o `saga.transicao`.

## Alternativas consideradas

### Manter a orquestração dentro da Adoção

É o desenho da ADR-002 e o código atual. Funciona e tem menos peças, mas mantém as duas razões para mudar e as duas cargas no mesmo processo. Também esconde a SAGA, que é o requisito central da disciplina, dentro de um serviço de domínio. Rejeitada.

### Orquestrador chamado por HTTP pela Adoção

A Adoção chamaria o Orquestrador a cada solicitação e a cada decisão, e consultaria o estado dele a cada `GET`. O estado ficaria sempre atual, mas as telas da Adoção cairiam junto com o Orquestrador, e a decisão do responsável se perderia se ele estivesse fora do ar. Com eventos e outbox, a decisão espera na fila. Rejeitada.

### Coreografia

Cada serviço reagiria aos eventos dos outros. Já foi rejeitada na ADR-002: o estado ficaria espalhado e o prazo de 72 h não teria dono. A separação do Orquestrador não muda esse argumento.

| Critério | Orquestrador separado, por eventos (escolhida) | Orquestração na Adoção | Orquestrador por HTTP |
| --- | --- | --- | --- |
| Onde fica o estado da SAGA | só no Orquestrador | na Adoção, junto com as telas | só no Orquestrador |
| Razões para mudar | separadas | misturadas | separadas |
| Escala | painel e SAGA escalam cada um com a própria carga | tudo junto | separada, mas o painel depende do Orquestrador |
| Orquestrador fora do ar | as telas continuam; decisões esperam na fila | não se aplica | as telas e as decisões falham |
| Peças a operar | um serviço e um banco a mais | as atuais | um serviço e um banco a mais |
| Consistência do estado na tela | eventual (milissegundos, pelo `saga.transicao`) | imediata | imediata |

## Consequências

- Um microsserviço e um PostgreSQL a mais no compose e no cluster.
- A Adoção vira participante: perde o verificador de prazos, os passos e o consumidor de respostas, e ganha um consumidor de `saga.transicao`.
- Os participantes (Animais e Identidade) passam a responder com a routing key `orquestrador`, e não mais `adocao`. A fila `adocao.respostas` dá lugar a `orquestrador.respostas`.
- O estado mostrado pela Adoção é eventual: logo depois de uma aprovação, o `GET` ainda pode mostrar `AGUARDANDO_APROVACAO` por alguns milissegundos.
- O catálogo de mensagens ganha `solicitacao.criada`, `solicitacao.decidida`, `solicitacao.retomada` e `saga.transicao` (#139).
- A extração do código está na #140.
