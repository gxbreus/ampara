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
  - APIs externas: `/api/v1`, `/web/v1` e `/mobile/v1`.
  - APIs internas entre BFFs e serviços: `/v1/...`.
- O contrato acompanha a versão maior no nome: `<servico>.v1.yaml`. O campo
  `info.version` usa semver para identificar mudanças compatíveis dentro da
  mesma versão maior, por exemplo `1.2.0`.
- Uma `v2` incompatível é publicada em paralelo à `v1` por ao menos uma
  entrega. O Gateway e, depois, o Ingress mantêm rotas distintas para as duas
  versões durante a migração.

| Mudança | Compatível com `v1`? | Tratamento |
| --- | --- | --- |
| Adicionar campo opcional em resposta | Sim | Atualiza o contrato em semver menor/patch. |
| Adicionar rota | Sim | Publica na `v1`. |
| Adicionar valor de enum, quando o consumidor ignora desconhecidos | Sim | Publica na `v1` e documenta o novo valor. |
| Remover ou renomear campo | Não | Cria `v2` em paralelo. |
| Mudar o tipo de um campo | Não | Cria `v2` em paralelo. |
| Tornar campo opcional obrigatório | Não | Cria `v2` em paralelo. |
| Mudar a semântica de um status HTTP ou valor existente | Não | Cria `v2` em paralelo. |

Exemplo: se a busca de Animais trocar `fotoCapa` (URL única) por `fotos`
(lista), a resposta `v1` conserva `fotoCapa`; a resposta `v2` expõe `fotos`.
O BFF Mobile e o cliente que ainda leem `fotoCapa` continuam na rota `v1` até
a migração terminar.

### Eventos RabbitMQ

Todo evento e comando possui um envelope com `messageId` e `version`. O
consumidor é tolerante a campos que não conhece, mas só processa versões que
suporta. Uma versão desconhecida é registrada em log e enviada à DLQ em vez de
ser interpretada com suposições. Enquanto houver consumidor antigo, produtor e
consumidor publicam/aceitam as versões compatíveis lado a lado.

Um reenvio por timeout preserva o mesmo `messageId` e a mesma `version`: é uma
nova tentativa de entrega, não uma nova versão do contrato. Isso preserva a
idempotência dos consumidores.

Exemplo de envelope:

```json
{
  "messageId": "6de6dcf0-11ed-4d4a-95dc-a4eb3f5de1a1",
  "version": 1,
  "type": "solicitacao.criada",
  "correlationId": "06c4340c-554f-4b9b-a94f-ef4434a2d19a",
  "data": {}
}
```

Esta regra também orienta o catálogo de eventos da #25.

## Alternativas consideradas

### Versão no header `Accept`

Foi rejeitada porque Gateway e Ingress teriam de inspecionar headers para
separar versões. A URI deixa a rota, a observabilidade e a reprodução com
`curl` explícitas para a demonstração.

### Query string (`?v=1`)

Foi rejeitada porque mistura o contrato da API aos filtros da requisição e
facilita clientes omitirem a versão sem perceber. Também não forma uma rota
independente para Gateway e Ingress.

## Consequências

- Rotas externas ficam previsíveis e podem ser roteadas apenas pelo caminho.
- Uma quebra de contrato exige manter duas versões por um período, aumentando
  temporariamente testes e documentação.
- Produtores e consumidores de eventos precisam declarar a versão que aceitam
  e tratar versões desconhecidas de forma observável, sem descartar dados em
  silêncio.
