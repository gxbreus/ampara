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
sob `/mobile/v1` exigem JWT de ADOTANTE. Só GET `/mobile/v1/animais` (busca e
detalhe) é público.
O gateway encaminha o prefixo completo. A implantação do Kong está na #43.

Verificação: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
Imagem: `docker build -t ampara/bff-mobile:dev bff/mobile` na raiz.
O tamanho real da imagem e o teste via Kong dependem de Docker disponível;
não há medição local registrada nesta entrega.

## Rotas do adotante

Busca e detalhe aceitam acesso anônimo. Um token fornecido é validado, inclusive
emissor, assinatura e expiração. Se o token for válido e de ADOTANTE, a resposta traz
`minhaSolicitacao`; se estiver vencido, malformado ou for de outro role, a requisição
segue como anônima (200, sem consultar a Adoção e sem repassar o token) em vez de
401/403. A busca serializa somente os oito campos do card e consulta solicitações
ativas em lote. Falha na Adoção gera aviso sem derrubar a busca.

`Idempotency-Key` no `POST /mobile/v1/solicitacoes` é opcional. Quando vem, precisa ter
de 8 a 128 caracteres (os limites da Adoção) e é repassada como está. Quando não vem,
o BFF não gera uma: um UUID novo a cada tentativa não deduplicaria nada. A Adoção aceita
o POST sem a chave e continua barrando uma segunda solicitação ativa para o mesmo animal
(409).

A lista de solicitações usa o mesmo cartão da busca: `fotoThumb` é a miniatura da
projeção quando o Animais a entrega e, no modelo de escrita devolvido por
`GET /v1/animais?ids=`, a primeira foto (a mesma regra com que o Animais monta
`fotoThumb` na projeção); `cidade` vem de `endereco.cidade`. O resto do endereço não sai
do BFF.

Erros de validação de path, query, header ou corpo saem como 400
`parametros-invalidos`, como em `ParametrosInvalidos` no contrato. O 422 que o Animais
devolve para filtros de busca inválidos também vira 400.

Solicitações são filtradas pelo dono do JWT. As ações vêm dos links da Adoção,
e os links externos são reescritos para `/mobile/v1`. Perfil e avisos repassam o
Authorization original; o Assistente usa prazo de 20 s e fallback em indisponibilidade.
Testes usam serviços simulados; integração completa depende dos serviços dos demais donos.

O Assistente tem contrato interno próprio: o BFF adapta fontes e sugestões
para os campos mobile. Recomendações exigem `lat` e `lng` do contexto de busca;
`raioKm` vale 10 se omitido. Coordenadas ausentes ou inválidas recebem 400 antes
de chamar o serviço. Metadados de cache e latência ficam no serviço interno.

## Issues

- #30 — contrato
- #45 — esqueleto e Dockerfile
- #47 — Kubernetes
- #62 — busca, detalhe e solicitações

Validação de 17/11/2026: 15 testes, lint, tipos e build passaram. As respostas do
BFF de busca, detalhe, solicitações e linha do tempo são verificadas contra o
OpenAPI; o JWT é exercitado com pares RSA reais. A medição com 20 cards fica
abaixo de 6 KB. Esses testes não substituem o ensaio contra os serviços de domínio.
