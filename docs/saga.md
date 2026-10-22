# SAGA de adoção

Este documento modela a SAGA que leva uma solicitação de adoção do pedido até a conclusão ou o encerramento. Ela é **orquestrada** pelo serviço **Orquestrador**, que conversa com os participantes (Animais, Identidade e Notificações) por **comandos e respostas no RabbitMQ**. A justificativa está na [ADR-002](decisoes/ADR-002-saga-orquestrada.md) e, para a separação entre Adoção e Orquestrador, na [ADR-008](decisoes/ADR-008-orquestrador.md).

A **Adoção** é dona do que o usuário vê. Ela recebe o pedido do adotante e a decisão do responsável e os entrega ao Orquestrador por eventos (`solicitacao.criada`, `solicitacao.decidida` e `solicitacao.retomada`). O Orquestrador devolve cada transição em `saga.transicao`, e a Adoção mantém com ele o estado e a linha do tempo que as telas mostram. Neste documento, "a solicitação" e "a SAGA" têm o mesmo id e passam pelos mesmos estados.

Os nomes de estados seguem o contrato [`adocao.v1.yaml`](contratos/adocao.v1.yaml). Os nomes de comandos, respostas e eventos seguem o catálogo de mensagens (`docs/contratos/eventos.md`, #25).

## 1. Máquina de estados

A solicitação tem 5 estados ativos e 7 finais.

- **Ativos:** `SOLICITADA`, `ANIMAL_RESERVADO`, `AGUARDANDO_APROVACAO`, `APROVADA` e `COMPENSANDO`.
- **Finais:** `CONCLUIDA`, `REJEITADA_INDISPONIVEL`, `PERFIL_INVALIDO`, `RECUSADA`, `CANCELADA`, `EXPIRADA` e `FALHOU`.

Não existe estado de "perfil validado": o T3 é um evento publicado na mesma transação que grava `AGUARDANDO_APROVACAO`. Enquanto está em `COMPENSANDO`, a solicitação guarda no campo `desfecho` o estado final que será gravado quando as compensações terminarem.

Os números entre parênteses são os da [tabela de transições](#3-transições).

```mermaid
stateDiagram-v2
    [*] --> SOLICITADA: (1) solicitacao.criada / T1
    SOLICITADA --> ANIMAL_RESERVADO: (2) AnimalReservado / T2
    SOLICITADA --> REJEITADA_INDISPONIVEL: (3) ReservaRecusada
    SOLICITADA --> FALHOU: (4) timeout T1 / C1 precautória
    ANIMAL_RESERVADO --> AGUARDANDO_APROVACAO: (5) PerfilValidado / T3
    ANIMAL_RESERVADO --> COMPENSANDO: (6) PerfilRecusado / C1
    ANIMAL_RESERVADO --> COMPENSANDO: (7) timeout T2 / C1 + C2 precautória
    AGUARDANDO_APROVACAO --> APROVADA: (8) aprovar, pivô / T4
    AGUARDANDO_APROVACAO --> COMPENSANDO: (9) recusar / C2 + C1
    AGUARDANDO_APROVACAO --> COMPENSANDO: (10) cancelar / C2 + C1
    AGUARDANDO_APROVACAO --> COMPENSANDO: (11) prazo expirado / C2 + C1
    APROVADA --> APROVADA: (14) AdocaoConfirmada / T5
    APROVADA --> APROVADA: (16) timeout T4 ou T5 / reenvia
    APROVADA --> CONCLUIDA: (15) AdocaoRegistrada / T6
    APROVADA --> COMPENSANDO: (17) ConfirmacaoRecusada / C2 + C1 condicional
    COMPENSANDO --> COMPENSANDO: (13) timeout de compensação / reenvia até o teto
    COMPENSANDO --> COMPENSANDO: (18) resposta tardia / reemite compensação
    COMPENSANDO --> PERFIL_INVALIDO: (12) última compensação bloqueante
    COMPENSANDO --> RECUSADA: (12) última compensação bloqueante
    COMPENSANDO --> CANCELADA: (12) última compensação bloqueante
    COMPENSANDO --> EXPIRADA: (12) última compensação bloqueante
    COMPENSANDO --> FALHOU: (12) última compensação bloqueante
    note right of FALHOU
        (18) resposta tardia em estado final
        reemite a compensação sem mudar o estado
    end note
    CONCLUIDA --> [*]
    REJEITADA_INDISPONIVEL --> [*]
    PERFIL_INVALIDO --> [*]
    RECUSADA --> [*]
    CANCELADA --> [*]
    EXPIRADA --> [*]
    FALHOU --> [*]
```

## 2. Passos

| Passo | Mensagem | Participante | Efeito | Respostas | Compensação |
| --- | --- | --- | --- | --- | --- |
| T1 | `ReservarAnimal` | Animais | `DISPONIVEL` → `RESERVADO` | `AnimalReservado` · `ReservaRecusada` | C1 `LiberarReserva` → `ReservaLiberada` |
| T2 | `ValidarPerfil` | Identidade | confere o perfil de adoção e ocupa a vaga (1 solicitação ativa por adotante) | `PerfilValidado` · `PerfilRecusado` | C2 `LiberarVaga` → `VagaLiberada` |
| T3 | `adocao.aguardando_aprovacao` (evento) | Notificações | avisa o responsável | — | não tem: só avisa e pode ser repetido |
| **Pivô** | aprovação humana, registrada na Adoção e entregue em `solicitacao.decidida` | Orquestrador | — | — | — |
| T4 | `ConfirmarAdocao` | Animais | `RESERVADO` → `ADOTADO` | `AdocaoConfirmada` · `ConfirmacaoRecusada` | não tem: retentável |
| T5 | `RegistrarAdocao` | Identidade | registra a adoção no histórico do adotante e libera a vaga | `AdocaoRegistrada` | não tem: retentável |
| T6 | `adocao.concluida` (evento) | Notificações | avisa o adotante e o responsável | — | não tem: retentável |

O **pivô** é a aprovação do responsável. Antes dele, toda falha desfaz o que já foi feito. Depois dele, T4, T5 e T6 só são reenviados até dar certo, nunca compensados. A única exceção é a invariante quebrada da transição 17.

Os motivos de recusa vêm no payload da resposta:

- `ReservaRecusada`: `INDISPONIVEL`, `INEXISTENTE` ou `SAGA_ENCERRADA`;
- `PerfilRecusado`: `PERFIL_INCOMPLETO`, `LIMITE_SOLICITACOES`, `CONTA_INEXISTENTE` ou `SAGA_ENCERRADA`.

`SAGA_ENCERRADA` é a [defesa dos participantes](#7-defesa-nos-participantes) contra comandos que chegam depois da compensação.

## 3. Transições

Há dois tipos de compensação:

- **Bloqueante:** desfaz um passo **confirmado**. O estado final só é gravado quando a resposta dela chega. Por isso o aviso de encerramento já significa que o animal voltou para a busca.
- **Precautória:** desfaz um passo de resultado **incerto**, depois de um timeout. Sai pelo outbox, mas não segura o estado final. Como as filas são duráveis, ela é entregue quando o participante voltar.

| # | De | Gatilho | Para | Outbox emite |
| --- | --- | --- | --- | --- |
| 1 | — | `solicitacao.criada` (o `POST /v1/solicitacoes` na Adoção) | `SOLICITADA` | `ReservarAnimal` (T1) |
| 2 | `SOLICITADA` | `AnimalReservado` | `ANIMAL_RESERVADO` | `ValidarPerfil` (T2) |
| 3 | `SOLICITADA` | `ReservaRecusada` | `REJEITADA_INDISPONIVEL` | `adocao.falhou` (sem compensação) |
| 4 | `SOLICITADA` | timeout do T1 | `FALHOU` | `LiberarReserva` (C1 precautória) + `adocao.falhou` |
| 5 | `ANIMAL_RESERVADO` | `PerfilValidado` | `AGUARDANDO_APROVACAO` (grava `expira_em`) | `adocao.aguardando_aprovacao` (T3) |
| 6 | `ANIMAL_RESERVADO` | `PerfilRecusado` | `COMPENSANDO` (desfecho `PERFIL_INVALIDO`) | `LiberarReserva` (C1 bloqueante) |
| 7 | `ANIMAL_RESERVADO` | timeout do T2 | `COMPENSANDO` (desfecho `FALHOU`) | C1 bloqueante + `LiberarVaga` (C2 precautória) |
| 8 | `AGUARDANDO_APROVACAO` | `solicitacao.decidida` (`APROVADA`) | `APROVADA` | `ConfirmarAdocao` (T4) + `adocao.aprovada` |
| 9 | `AGUARDANDO_APROVACAO` | `solicitacao.decidida` (`RECUSADA`) | `COMPENSANDO` (desfecho `RECUSADA`) | C2 + C1, ambas bloqueantes |
| 10 | `AGUARDANDO_APROVACAO` | `solicitacao.decidida` (`CANCELADA`) | `COMPENSANDO` (desfecho `CANCELADA`) | C2 + C1, ambas bloqueantes |
| 11 | `AGUARDANDO_APROVACAO` | `expira_em` vencido | `COMPENSANDO` (desfecho `EXPIRADA`) | C2 + C1, ambas bloqueantes |
| 12 | `COMPENSANDO` | última resposta bloqueante (`ReservaLiberada` ou `VagaLiberada`) | o desfecho gravado | `adocao.recusada`, `adocao.cancelada`, `adocao.expirada` ou `adocao.falhou` |
| 13 | `COMPENSANDO` | timeout de uma compensação | `COMPENSANDO` | reenvia o mesmo comando, com o mesmo `messageId` e backoff exponencial, até `ORQUESTRADOR_MAX_REENVIOS_COMPENSACAO` (padrão 10); no teto, marca o passo como `ESGOTADO` e a SAGA com `requer_intervencao` |
| 14 | `APROVADA` (passo T4) | `AdocaoConfirmada` | `APROVADA` (passo T5) | `RegistrarAdocao` (T5) |
| 15 | `APROVADA` (passo T5) | `AdocaoRegistrada` | `CONCLUIDA` | `adocao.concluida` (T6) |
| 16 | `APROVADA` | timeout do T4 ou do T5 | `APROVADA` | reenvia o mesmo comando (passo retentável, sem compensação) |
| 17 | `APROVADA` | `ConfirmacaoRecusada` (invariante violada) | `COMPENSANDO` (desfecho `FALHOU`) | C2 bloqueante + C1 condicional + log crítico |
| 18 | estado final ou `COMPENSANDO` | resposta positiva tardia (`AnimalReservado` ou `PerfilValidado`) | não muda | reemite a compensação correspondente (`LiberarReserva` ou `LiberarVaga`) |

Observações:

- **Transição 3:** `INDISPONIVEL` e `INEXISTENTE` terminam em `REJEITADA_INDISPONIVEL`, com o motivo gravado. Nada foi feito ainda, então não há o que compensar.
- **Transição 4:** a C1 é precautória porque não se sabe se o `ReservarAnimal` foi aplicado. Os dois comandos vão para a mesma fila (`animais.comandos`), na ordem em que foram publicados. Se a reserva chegou a acontecer, a liberação vem logo depois.
- **Transição 6:** só C1, porque a Identidade não ocupa a vaga quando recusa o perfil.
- **Transição 7:** a reserva foi confirmada (C1 bloqueante), mas não se sabe se a vaga foi ocupada (C2 precautória).
- **Transição 12:** nos desfechos `PERFIL_INVALIDO` e `FALHOU`, o evento é `adocao.falhou`, com o motivo no payload (`PERFIL_INCOMPLETO`, `LIMITE_SOLICITACOES`, `CONTA_INEXISTENTE`, `TIMEOUT_T2` ou `CONFIRMACAO_RECUSADA`). Nas transições 3 e 4, os motivos são `INDISPONIVEL`, `INEXISTENTE` e `TIMEOUT_T1`.
- **Transição 17:** acontece se o animal deixou de estar reservado para esta SAGA antes do T4, por exemplo por uma mudança manual de status. A C1 é condicional: Animais só libera a reserva se ela ainda pertencer a este `sagaId`, e responde `ReservaLiberada` mesmo quando não há nada a liberar.

## 4. Compensações por cenário

| # | Cenário | Onde falha | Transições | O que o orquestrador faz | Estado final | Evento |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Concorrência: animal já reservado por outra SAGA | T1 | 3 | encerra sem compensar | `REJEITADA_INDISPONIVEL` | `adocao.falhou` (`INDISPONIVEL`) |
| 2 | Animal inexistente | T1 | 3 | encerra sem compensar | `REJEITADA_INDISPONIVEL` | `adocao.falhou` (`INEXISTENTE`) |
| 3 | Timeout do T1 (Animais fora do ar) | T1 | 4 | C1 precautória | `FALHOU` | `adocao.falhou` (`TIMEOUT_T1`) |
| 4 | Timeout do T2 (Identidade fora do ar) | T2 | 7 → 12 | C1 bloqueante + C2 precautória | `FALHOU` | `adocao.falhou` (`TIMEOUT_T2`) |
| 5 | Timeout do T4 ou do T5 | depois do pivô | 16 | reenvia o mesmo comando até responder; não compensa | segue até `CONCLUIDA` | `adocao.concluida` |
| 6 | Perfil inválido (incompleto, limite de solicitações ou conta inexistente) | T2 | 6 → 12 | C1 bloqueante | `PERFIL_INVALIDO` | `adocao.falhou` (motivo da Identidade) |
| 7 | Recusa do responsável | decisão | 9 → 12 | C2 + C1 bloqueantes | `RECUSADA` | `adocao.recusada` |
| 8 | Cancelamento pelo adotante | decisão | 10 → 12 | C2 + C1 bloqueantes | `CANCELADA` | `adocao.cancelada` |
| 9 | Expiração do prazo | decisão | 11 → 12 | C2 + C1 bloqueantes | `EXPIRADA` | `adocao.expirada` |
| 10 | Notificações fora do ar | T3 ou T6 | — | nada: os eventos ficam na fila durável `notificacoes.eventos` e são entregues quando o serviço volta; a SAGA não espera por ele | não muda | entregue depois |
| 11 | `ConfirmacaoRecusada` (invariante violada) | T4 | 17 → 12 | C2 bloqueante + C1 condicional + log crítico | `FALHOU` | `adocao.falhou` (`CONFIRMACAO_RECUSADA`) |
| 12 | Timeout de uma compensação (participante fora do ar ou mensagem envenenada na DLQ) | C1 ou C2 | 13 | reenvia com o mesmo `messageId` e backoff exponencial; no teto, para, marca `requer_intervencao`, loga `CRITICAL` e espera a retomada manual de um ADMIN (#86) | continua `COMPENSANDO` até a resposta | — |
| 13 | Resposta tardia (participante volta depois do timeout) | T1 ou T2 | 18 | reemite `LiberarReserva` ou `LiberarVaga` | não muda | — |
| 14 | Corrida entre aprovação e expiração | decisão | 8 ou 11 | no Orquestrador, `SELECT … FOR UPDATE` serializa o `solicitacao.decidida` e o verificador de prazos; quem pega o lock primeiro vence. Se a expiração venceu, a decisão recebe `ack` e só um aviso no log (o responsável já recebeu 202 da Adoção e vê `EXPIRADA` pelo `saga.transicao`); se a aprovação venceu, o verificador encontra `APROVADA` e não faz nada | `CONCLUIDA` ou `EXPIRADA` | o do vencedor |
| 15 | Clique duplo em aprovar, ou aprovar e cancelar ao mesmo tempo | decisão | 8 | a Adoção trava a solicitação e aceita uma única decisão; a segunda requisição recebe 409, e sai um único `solicitacao.decidida` | `CONCLUIDA` | `adocao.concluida` |
| 16 | Mensagem duplicada (reentrega do RabbitMQ) | qualquer passo | — | a inbox do participante devolve a resposta já gravada; as inboxes do Orquestrador e da Adoção descartam a mensagem repetida; todos fazem `ack` sem repetir o efeito | não muda | — |
| 17 | Queda do Orquestrador | qualquer passo | — | o estado e o outbox estão no banco: ao subir, o relay publica o que ficou pendente, o verificador de timeouts trata os prazos vencidos, e as respostas e os `solicitacao.*` sem `ack` voltam da fila. Enquanto ele está fora, a Adoção continua atendendo as telas | retoma de onde parou | — |
| 18 | Queda da Adoção | qualquer passo | — | a SAGA continua no Orquestrador; os `saga.transicao` esperam na fila `adocao.saga` e atualizam o espelho quando ela volta | não muda | — |

## 5. Diagramas de sequência

### 5.1 Caminho feliz

A cada transição, o Orquestrador também publica um `saga.transicao`, e a Adoção atualiza o estado e a linha do tempo. Para não poluir, o diagrama mostra isso uma vez só.

```mermaid
sequenceDiagram
    autonumber
    actor AT as Adotante
    actor RE as Responsável
    participant AD as Adoção
    participant MQ as RabbitMQ
    participant OR as Orquestrador
    participant AN as Animais
    participant ID as Identidade
    participant NO as Notificações

    AT->>AD: POST /v1/solicitacoes
    AD->>AD: grava SOLICITADA + solicitacao.criada no outbox
    AD-->>AT: 202 + Location
    AD->>MQ: solicitacao.criada
    MQ->>OR: solicitacao.criada
    OR->>OR: grava SOLICITADA + outbox
    OR->>MQ: ReservarAnimal (T1) + saga.transicao
    MQ-->>AD: saga.transicao (espelho)
    MQ->>AN: ReservarAnimal
    AN->>AN: DISPONIVEL para RESERVADO
    AN-->>MQ: AnimalReservado
    MQ-->>OR: AnimalReservado
    OR->>OR: grava ANIMAL_RESERVADO + outbox
    OR->>MQ: ValidarPerfil (T2)
    MQ->>ID: ValidarPerfil
    ID->>ID: confere o perfil e ocupa a vaga
    ID-->>MQ: PerfilValidado
    MQ-->>OR: PerfilValidado
    OR->>OR: grava AGUARDANDO_APROVACAO + expira_em + outbox
    OR->>MQ: adocao.aguardando_aprovacao (T3)
    MQ->>NO: adocao.aguardando_aprovacao
    NO-->>RE: nova solicitação
    RE->>AD: POST /v1/solicitacoes/ID/aprovacao
    AD->>AD: grava a decisão + solicitacao.decidida no outbox
    AD-->>RE: 202 (decisao APROVADA, sem links de ação)
    AD->>MQ: solicitacao.decidida (APROVADA)
    MQ->>OR: solicitacao.decidida
    OR->>OR: grava APROVADA (pivô) + outbox
    OR->>MQ: ConfirmarAdocao (T4) + adocao.aprovada
    MQ->>AN: ConfirmarAdocao
    AN->>AN: RESERVADO para ADOTADO
    AN-->>MQ: AdocaoConfirmada
    MQ-->>OR: AdocaoConfirmada
    OR->>OR: grava passo T5 + outbox
    OR->>MQ: RegistrarAdocao (T5)
    MQ->>ID: RegistrarAdocao
    ID->>ID: registra a adoção e libera a vaga
    ID-->>MQ: AdocaoRegistrada
    MQ-->>OR: AdocaoRegistrada
    OR->>OR: grava CONCLUIDA + outbox
    OR->>MQ: adocao.concluida (T6)
    MQ->>NO: adocao.aprovada e adocao.concluida
    NO-->>AT: adoção concluída
```

### 5.2 Perfil incompleto (C1 bloqueante)

```mermaid
sequenceDiagram
    autonumber
    participant OR as Orquestrador
    participant MQ as RabbitMQ
    participant AN as Animais
    participant ID as Identidade
    participant NO as Notificações

    OR->>OR: grava SOLICITADA + outbox
    OR->>MQ: ReservarAnimal (T1)
    MQ->>AN: ReservarAnimal
    AN-->>MQ: AnimalReservado
    MQ-->>OR: AnimalReservado
    OR->>OR: grava ANIMAL_RESERVADO + outbox
    OR->>MQ: ValidarPerfil (T2)
    MQ->>ID: ValidarPerfil
    ID->>ID: perfil sem aceite do termo, não ocupa a vaga
    ID-->>MQ: PerfilRecusado (PERFIL_INCOMPLETO)
    MQ-->>OR: PerfilRecusado
    OR->>OR: grava COMPENSANDO (desfecho PERFIL_INVALIDO) + outbox
    OR->>MQ: LiberarReserva (C1 bloqueante)
    MQ->>AN: LiberarReserva
    AN->>AN: RESERVADO para DISPONIVEL
    AN-->>MQ: ReservaLiberada
    MQ-->>OR: ReservaLiberada
    OR->>OR: grava PERFIL_INVALIDO + outbox
    OR->>MQ: adocao.falhou (PERFIL_INCOMPLETO)
    MQ->>NO: adocao.falhou
    Note over NO: avisa o adotante para completar o perfil
```

### 5.3 Recusa (C2 + C1)

```mermaid
sequenceDiagram
    autonumber
    actor RE as Responsável
    participant AD as Adoção
    participant MQ as RabbitMQ
    participant OR as Orquestrador
    participant AN as Animais
    participant ID as Identidade
    participant NO as Notificações

    Note over AD,OR: solicitação em AGUARDANDO_APROVACAO
    RE->>AD: POST /v1/solicitacoes/ID/recusa
    AD->>AD: grava a decisão + solicitacao.decidida no outbox
    AD-->>RE: 202
    AD->>MQ: solicitacao.decidida (RECUSADA)
    MQ->>OR: solicitacao.decidida
    OR->>OR: grava COMPENSANDO (desfecho RECUSADA) + outbox
    par compensações bloqueantes
        OR->>MQ: LiberarVaga (C2)
        MQ->>ID: LiberarVaga
        ID-->>MQ: VagaLiberada
        MQ-->>OR: VagaLiberada
    and
        OR->>MQ: LiberarReserva (C1)
        MQ->>AN: LiberarReserva
        AN->>AN: RESERVADO para DISPONIVEL
        AN-->>MQ: ReservaLiberada
        MQ-->>OR: ReservaLiberada
    end
    OR->>OR: última resposta chegou, grava RECUSADA + outbox
    OR->>MQ: adocao.recusada + saga.transicao
    MQ->>NO: adocao.recusada
    MQ-->>AD: saga.transicao (RECUSADA)
    Note over NO: o aviso só sai com o animal já de volta na busca
```

### 5.4 Identidade fora do ar (falha técnica)

```mermaid
sequenceDiagram
    autonumber
    participant OR as Orquestrador
    participant MQ as RabbitMQ
    participant AN as Animais
    participant ID as Identidade
    participant NO as Notificações

    OR->>OR: grava SOLICITADA + outbox
    OR->>MQ: ReservarAnimal (T1)
    MQ->>AN: ReservarAnimal
    AN-->>MQ: AnimalReservado
    MQ-->>OR: AnimalReservado
    OR->>OR: grava ANIMAL_RESERVADO + outbox
    OR->>MQ: ValidarPerfil (T2)
    Note over ID: Identidade com 0 réplicas, o comando fica na fila
    OR->>OR: ORQUESTRADOR_TIMEOUT_PASSO estoura, grava COMPENSANDO (desfecho FALHOU)
    OR->>MQ: LiberarReserva (C1 bloqueante) + LiberarVaga (C2 precautória)
    MQ->>AN: LiberarReserva
    AN-->>MQ: ReservaLiberada
    MQ-->>OR: ReservaLiberada
    OR->>OR: grava FALHOU + outbox
    OR->>MQ: adocao.falhou (TIMEOUT_T2)
    MQ->>NO: adocao.falhou
    Note over ID: Identidade volta
    MQ->>ID: ValidarPerfil (atrasado)
    ID-->>MQ: PerfilValidado (tardio)
    MQ->>ID: LiberarVaga (C2 precautória)
    ID-->>MQ: VagaLiberada
    MQ-->>OR: PerfilValidado (tardio)
    OR->>MQ: reemite LiberarVaga (transição 18)
    MQ->>ID: LiberarVaga
    ID-->>MQ: VagaLiberada (inbox, sem novo efeito)
```

## 6. Regras do Orquestrador

- **Estado e outbox na mesma transação.** Toda transição abre a transação, faz `SELECT … FOR UPDATE` na linha da SAGA, calcula a transição, grava `sagas`, `saga_passos`, `saga_historico` e `outbox` (com os comandos, os eventos e o `saga.transicao`) e só então faz o commit. Nenhuma mensagem é publicada fora do outbox.
- **Lock em toda transição.** O `FOR UPDATE` serializa as decisões (`solicitacao.decidida`), a expiração e as respostas que chegam ao mesmo tempo para a mesma SAGA. Uma decisão que encontra a SAGA fora de `AGUARDANDO_APROVACAO` recebe `ack` e só um aviso no log: não é erro de mensagem e não vai para a DLQ.
- **Comandos idempotentes por `sagaId` + passo.** Cada passo tem uma linha em `saga_passos` com o `messageId` do comando.
- **Reenvio com o mesmo `messageId`.** Um comando reenviado por timeout mantém o `messageId`, para a inbox do participante devolver a resposta já gravada em vez de aplicar o efeito de novo.
- **Encerramento depois das compensações bloqueantes.** `adocao.recusada`, `adocao.cancelada`, `adocao.expirada` e o `adocao.falhou` que vem de `COMPENSANDO` só saem na transição 12.
- **Teto de reenvios das compensações.** Reenviar para sempre faria uma mensagem envenenada entrar em loop com a DLQ, com o animal preso. Ao atingir `ORQUESTRADOR_MAX_REENVIOS_COMPENSACAO`, o passo fica `ESGOTADO`, a SAGA continua em `COMPENSANDO` com `requer_intervencao` e um ADMIN retoma manualmente depois de corrigir a causa, pela rota de retomada da Adoção, que publica `solicitacao.retomada`; os passos são reenviados com o mesmo `messageId` (#86). Os passos retentáveis depois do pivô (transição 16) seguem a mesma regra.
- **Prazos configuráveis.** `ORQUESTRADOR_TIMEOUT_PASSO` define o timeout de cada passo (10 s). `ORQUESTRADOR_PRAZO_EXPIRACAO` define o prazo da decisão humana (72 h em produção, 2 min na demo, via ConfigMap).
- **Retomada ao reiniciar.** Nada fica em memória. Ao subir, o relay publica o outbox pendente e o verificador de timeouts trata os passos com prazo vencido.
- **Espelho na Adoção.** Toda transição gera um `saga.transicao` com uma `versao` crescente. A Adoção aplica ao estado só a versão maior que a gravada e ordena a linha do tempo pela versão, então a ordem de chegada não importa.
- **Correlação.** Toda mensagem leva `sagaId` (igual ao id da solicitação) e `correlationId`, e todo log de transição registra `sagaId`, `correlationId`, `estado`, `passo` e `evento`.

## 7. Defesa nos participantes

Animais e Identidade guardam a marca `sagas_compensadas`: ao aplicar uma compensação (`LiberarReserva` ou `LiberarVaga`), registram o `sagaId`. Uma ação (`ReservarAnimal` ou `ValidarPerfil`) que chega depois disso para o mesmo `sagaId` é recusada com `SAGA_ENCERRADA`.

Isso cobre o caso em que a compensação precautória é processada antes do comando original, por exemplo quando o comando original é reentregue depois de uma queda do participante. Sem a marca, o animal ficaria reservado, ou a vaga ocupada, para uma SAGA que já terminou.

As respostas dos participantes não passam por outbox. O participante grava o efeito e a resposta na inbox na mesma transação, faz o commit, publica a resposta com *publisher confirm* e só então faz o `ack`. Se cair antes do `ack`, a mensagem volta, a inbox encontra a resposta gravada e o participante publica a mesma resposta de novo.

## 8. Como provocar cada falha na demo

| Cenário | Como provocar | O que mostrar |
| --- | --- | --- |
| Perfil incompleto | solicitar com o adotante do seed que não aceitou o termo de adoção | `PERFIL_INVALIDO`, animal de volta para `DISPONIVEL` e aviso ao adotante |
| Animal já reservado | dois adotantes solicitam o mesmo animal | o segundo termina em `REJEITADA_INDISPONIVEL` |
| Recusa | o responsável recusa pelo App Web | `COMPENSANDO` → `RECUSADA`, e o aviso só depois do animal liberado |
| Expiração | subir com `ORQUESTRADOR_PRAZO_EXPIRACAO=2m` e não decidir | `EXPIRADA` em cerca de 2 minutos |
| Identidade fora do ar | `kubectl scale deployment identidade --replicas=0` (no compose, `docker compose stop identidade`) e solicitar | depois de `ORQUESTRADOR_TIMEOUT_PASSO`, `FALHOU` com o animal liberado; ao voltar com `--replicas=1`, a vaga é liberada pela resposta tardia |
| Queda do Orquestrador | `kubectl delete pod` do Orquestrador no meio de uma SAGA | o novo pod retoma a SAGA do ponto em que parou |
| Orquestrador fora do ar | `kubectl scale deployment orquestrador --replicas=0` (no compose, `docker compose stop orquestrador`) e solicitar | a tela responde com `SOLICITADA`, a mensagem espera em `orquestrador.solicitacoes`, e a SAGA anda assim que ele volta |

A linha do tempo (`GET /v1/solicitacoes/{id}/historico`) mostra cada transição, e os logs filtrados por `sagaId` mostram as mensagens trocadas.

## 9. O que a implementação acrescentou (#58, #140)

A máquina de estados está em `services/orquestrador/internal/saga/maquina.go`, com uma linha de teste por transição. Ela foi escrita na Adoção (#58) e extraída sem mudança para o Orquestrador (#140). Em relação ao modelo acima, a implementação acrescentou quatro detalhes:

- **Conferência do prazo dentro da transação.** Com duas réplicas, os dois verificadores podem achar o mesmo passo vencido. A segunda réplica espera o lock da SAGA, confere de novo o prazo, encontra-o já adiado pelo reenvio da primeira e não faz nada. Sem isso, o comando sairia duas vezes.
- **Respostas sem transição também entram na linha do tempo.** A primeira de duas compensações bloqueantes, ou a resposta a uma precautória, fecha o passo sem mudar o estado. Ela fica em `saga_historico` com `transicao = 0`, e o `saga.transicao` leva a mesma linha à Adoção, para a linha do tempo mostrar cada resposta recebida.
- **Passo esgotado ainda aceita a resposta.** Depois do teto de reenvios (#86), o passo fica `ESGOTADO`, mas a resposta que chegar mais tarde ainda é aplicada: é o participante voltando.
- **Uma decisão por solicitação, travada na Adoção.** Com a linha da solicitação travada, a Adoção só aceita uma decisão em `AGUARDANDO_APROVACAO`. A resposta mostra o campo `decisao` e esconde os links de ação até o `saga.transicao` trazer o novo estado; assim, o duplo clique e o "aprovar e cancelar ao mesmo tempo" não chegam a gerar duas mensagens.
