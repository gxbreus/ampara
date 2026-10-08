# ADR 006: Versionamento de APIs e eventos

- Status: aceita
- Data: 2026-10-07

## Contexto

App Web, App Mobile, dois BFFs e os serviços evoluem em ritmos diferentes. Uma
mudança incompatível não pode fazer um cliente ou consumidor ainda implantado
interpretar silenciosamente dados com outro significado. Como o Gateway e o
Ingress roteiam por caminho, a versão também precisa ser visível no caminho
HTTP, sem inspeção de headers.

## Decisão

### APIs HTTP

- A versão **maior** fica na URI.
  - APIs externas, publicadas pelo Gateway, seguem `/<cliente>/v<maior>/...`:
    `/web/v1` e `/mobile/v1` (BFFs) e `/auth/v1` (autenticação na Identidade).
  - APIs internas entre BFFs e serviços: `/v<maior>/...`, sem cliente.
- A versão externa e a interna são **eixos independentes**. O `v1` de
  `/web/v1` é a versão do contrato do BFF Web com o App Web; o `v1` de
  `/v1/solicitacoes` é a versão do contrato da Adoção com os BFFs. Se a Adoção
  publicar uma `v2`, o BFF Web passa a consumi-la e continua expondo `/web/v1`
  enquanto o contrato dele com o cliente não mudar. Uma `/web/v2` só surge
  quando o próprio BFF quebra esse contrato.
- O contrato acompanha a versão maior no nome: `<servico>.v1.yaml`. O campo
  `info.version` usa semver para identificar mudanças compatíveis dentro da
  mesma versão maior, por exemplo `1.2.0`.
- Uma `v2` incompatível é publicada em paralelo à `v1` por ao menos uma
  entrega. O Gateway e, depois, o Ingress mantêm rotas distintas para as duas
  versões durante a migração.

| Mudança | Compatível com `v1`? | Tratamento |
| --- | --- | --- |
| Adicionar campo opcional (resposta ou requisição) | Sim | Publica na `v1` e sobe a versão menor em `info.version`. |
| Adicionar rota | Sim | Publica na `v1`. |
| Adicionar valor de enum, quando o consumidor ignora desconhecidos | Sim | Publica na `v1` e documenta o novo valor. |
| Remover ou renomear campo | Não | Cria `v2` em paralelo. |
| Mudar o tipo de um campo | Não | Cria `v2` em paralelo. |
| Tornar obrigatório um campo opcional da requisição | Não | Cria `v2` em paralelo. |
| Adicionar campo obrigatório na requisição | Não | Cria `v2` em paralelo. |
| Mudar a semântica de um status HTTP ou valor existente | Não | Cria `v2` em paralelo. |

Exemplo: se a busca de Animais trocar `fotoCapa` (URL única) por `fotos`
(lista), a resposta `v1` conserva `fotoCapa`; a resposta `v2` expõe `fotos`.
O BFF Mobile e o cliente que ainda leem `fotoCapa` continuam na rota `v1` até
a migração terminar.

### Eventos RabbitMQ

Toda mensagem (comando, resposta ou evento) usa o envelope do catálogo, com
`messageId` e `version`; `version` é a versão do formato do `payload`. O
consumidor é um leitor tolerante: ignora campos que não conhece, mas só
processa versões que suporta. Uma versão desconhecida é registrada em log e
enviada à DLQ em vez de ser interpretada com suposições.

Adicionar um campo opcional ao `payload` é compatível e não muda a `version`.
Remover, renomear ou mudar o tipo de um campo cria a `version: 2`. Enquanto
houver consumidor antigo, o produtor publica a versão antiga e a nova lado a
lado. Os schemas do catálogo usam `additionalProperties: false` porque
descrevem exatamente o que o produtor emite; a tolerância é do consumidor.

A `version` do envelope não é a `version` que alguns payloads trazem, como os
eventos `animal.*`: essa é a versão do agregado, usada para descartar eventos
antigos na projeção.

Um reenvio por timeout preserva o mesmo `messageId` e a mesma `version`: é uma
nova tentativa de entrega, não uma nova versão do contrato. Isso preserva a
idempotência dos consumidores.

Exemplo de envelope:

```json
{
  "messageId": "6de6dcf0-11ed-4d4a-95dc-a4eb3f5de1a1",
  "type": "adocao.aprovada",
  "version": 1,
  "correlationId": "06c4340c-554f-4b9b-a94f-ef4434a2d19a",
  "sagaId": "7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17",
  "occurredAt": "2026-11-18T10:30:00Z",
  "payload": {}
}
```

O catálogo de mensagens ([`docs/contratos/eventos.md`](../contratos/eventos.md)) segue esta regra.

## Alternativas consideradas

### Versão no header `Accept`

Foi rejeitada porque Gateway e Ingress teriam de inspecionar headers para
separar versões. A URI deixa a rota, a observabilidade e a reprodução com
`curl` explícitas para a demonstração.

### Query string (`?v=1`)

Foi rejeitada porque mistura o contrato da API aos filtros da requisição e
facilita clientes omitirem a versão sem perceber. Também não forma uma rota
independente para Gateway e Ingress.

### Outros formatos de rota externa (#124)

- `/api/v1/auth` para a autenticação, como no primeiro rascunho: deixava a
  autenticação como a única rota externa com o prefixo `/api` e com a versão
  antes do recurso, fora do padrão das outras.
- Prefixo único `/api/<cliente>/v1`: mudaria o BFF Web, os testes, a reescrita
  dos links HATEOAS e o contrato, sem ganho para um host que só serve API.
- Login pelos BFFs (`/web/v1/sessoes`, `/mobile/v1/sessoes`): tiraria a
  Identidade do Gateway, mas exigiria rotas de sessão nos dois BFFs, e o BFF
  Mobile ainda não existe.

## Consequências

- Rotas externas ficam previsíveis e podem ser roteadas apenas pelo caminho.
- Uma quebra de contrato exige manter duas versões por um período, aumentando
  temporariamente testes e documentação.
- Produtores e consumidores de eventos precisam declarar a versão que aceitam
  e tratar versões desconhecidas de forma observável, sem descartar dados em
  silêncio.
