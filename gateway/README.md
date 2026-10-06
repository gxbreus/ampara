# API Gateway

Entrada única dos clientes: roteamento, validação do JWT (RS256, chave pública), rate limiting, `X-Correlation-Id` e CORS. Kong 3 OSS em modo DB-less; no Kubernetes, o mesmo Kong atua como Ingress Controller com as mesmas rotas.

| Rota externa | Destino |
| --- | --- |
| `/api/v1/auth` | Identidade (`/v1/auth`) — pública |
| `/mobile/v1/animais` (GET) | BFF Mobile — pública |
| `/mobile/v1` | BFF Mobile — JWT |
| `/web/v1` | BFF Web — JWT |

Aqui fica o `kong.template.yml`: a chave pública entra por variável de ambiente, e nenhum segredo é versionado.

**Responsável:** Gabriel Soares · **Issues:** #27 (rotas e ADR-005), #43 (Kong no compose), #46 (Kubernetes), #50 (Ingress)
