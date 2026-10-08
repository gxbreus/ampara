# ADR 005: API Gateway e BFFs

- Status: aceita
- Data: 2026-10-07

## Contexto

A Ampara possui dois clientes com jornadas e payloads distintos. O App Mobile
precisa de buscas leves e fluxo de adoção; o App Web concentra animais e
solicitações de protetores e ONGs. Os serviços de domínio também não podem ser
publicados diretamente: isso exporia portas, contratos internos e políticas de
segurança diferentes em cada serviço.

## Decisão

Usar Kong 3.8 DB-less como API Gateway e manter um BFF para cada cliente. O
Kong é a borda única: valida JWT RS256, aplica rate limit, correlation ID e
CORS, e encaminha apenas as quatro rotas externas descritas em
[`docs/gateway.md`](../gateway.md). Os BFFs agregam e moldam os dados para Web
e Mobile. Regras de negócio e autorização baseada em recurso permanecem nos
serviços de domínio.

## Alternativas consideradas

### Clientes falando diretamente com os BFFs

Rejeitada porque deixaria a validação de token, limitação e correlação
duplicadas em dois serviços expostos. Também tornaria a migração para Ingress
na Parte 3 menos direta.

### Apenas Gateway, sem BFFs

Rejeitada porque o Gateway não deve agregar dados nem conter lógica específica
de cliente. Isso concentraria no Kong transformações que pertencem a produtos
com ritmos diferentes e aumentaria o acoplamento com os serviços.

## Consequências

- Nenhum serviço de domínio possui rota externa.
- Web e Mobile podem evoluir seus payloads sem transformar o Gateway em camada
  de negócio.
- Há componentes adicionais para testar e operar, mas suas responsabilidades
  ficam separadas e observáveis.
