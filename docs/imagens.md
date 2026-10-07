# Imagens Docker

## Identidade

Medição local em 2026-10-07, com `node:22-alpine`, Docker 29.3.0 e o mesmo
contexto de build:

| Imagem | Estratégia | Tamanho | Usuário em runtime |
| --- | --- | ---: | --- |
| `ampara-identidade:single-test` | dependências de desenvolvimento e build na imagem final | 304.7 MB | root (padrão) |
| `ampara-identidade:local` | `deps` → `build` → `runtime`, somente dependências de produção e `dist/` | 209.3 MB | `node` |

A imagem multi-stage reduziu **95.4 MB** (31%) e não copia `src/` nem as
dependências de desenvolvimento para a etapa final.
