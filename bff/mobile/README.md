# BFF Mobile

Backend for Frontend do **App Mobile** (adotantes): respostas enxutas, distância e o status da solicitação do próprio adotante.

| | |
| --- | --- |
| **Stack** | Node.js 22 + TypeScript + Fastify |
| **Porta interna** | `3020` |
| **Rota no gateway** | `/mobile/v1` |
| **Banco** | nenhum (agrega dados dos serviços) |
| **Responsável** | Gabriel Cantanhede |

O schema de resposta do Fastify define exatamente os campos que o cliente recebe. A comparação com o outro BFF fica em `docs/contratos/bff-comparacao.md`.

## Executar e verificar

Node 22+, `npm ci`, `npm run dev`. Defina `JWT_PUBLIC_KEY` (PEM RS256) e as
URLs `IDENTIDADE_URL`, `ANIMAIS_URL`, `ADOCAO_URL`, `NOTIFICACOES_URL` e
`ASSISTENTE_URL`. `BFF_TIMEOUT_MS` vale 3000 por padrão.

`/health` é liveness; `/ready` verifica os cinco serviços em paralelo. As versões
sob `/mobile/v1` exigem JWT de ADOTANTE. Só GET `/mobile/v1/animais` é público.
O gateway encaminha o prefixo completo. A implantação do Kong está na #43.

Verificação: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
Imagem: `docker build -t ampara/bff-mobile:dev bff/mobile` na raiz.
O tamanho real da imagem e o teste via Kong dependem de Docker disponível;
não há medição local registrada nesta entrega.

## Rotas do adotante

Busca e detalhe aceitam acesso anônimo. Um token fornecido é validado, inclusive
emissor, assinatura e expiração. A busca serializa somente os oito campos do card
e consulta solicitações ativas em lote. Falha na Adoção gera aviso sem derrubar a busca.

Solicitações são filtradas pelo dono do JWT. As ações vêm dos links da Adoção,
e os links externos são reescritos para `/mobile/v1`. Perfil e avisos repassam o
Authorization original; o Assistente usa prazo de 20 s e fallback em indisponibilidade.
Testes usam serviços simulados; integração completa depende dos serviços dos demais donos.

## Issues

- #30 — contrato
- #45 — esqueleto e Dockerfile
- #47 — Kubernetes
- #62 — busca, detalhe e solicitações

Validação de 17/11/2026: 15 testes, lint, tipos e build passaram. As respostas do
BFF de busca, detalhe, solicitações e linha do tempo são verificadas contra o
OpenAPI; o JWT é exercitado com pares RSA reais. A medição com 20 cards fica
abaixo de 6 KB. Esses testes não substituem o ensaio contra os serviços de domínio.
