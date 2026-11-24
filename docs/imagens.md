# Tamanho das imagens

Cada dono preenche a linha da própria imagem ao criar o Dockerfile multi-stage (#38 a #45), medindo com `docker image ls`. A coluna "Ganho" é a redução do multi-stage em relação ao single-stage.

| Imagem | Single-stage | Multi-stage | Ganho | Observação |
| --- | ---: | ---: | ---: | --- |
| `ampara/identidade` | 511 MB | 325 MB | −36,4% | etapas `deps` → `build` → `runtime` em `node:22-alpine`, `npm ci --omit=dev`, usuário `node`; só `dist/` e dependências de produção na final, sem `src/` nem TypeScript |
| `ampara/animais` | 215 MB | 185 MB | −14,0% | etapa `builder` em `python:3.12-slim` com virtualenv isolado → `runtime` sem resíduos de cache de instalação, com usuário não-root `appuser` |
| `ampara/adocao` | 628 MB | 20,5 MB | −96,7% | etapa `golang:1.23-alpine` → `distroless/static-debian12:nonroot`; binário estático com as migrations embutidas, sem shell |
| `ampara/orquestrador` | 645 MB | 21,2 MB | −96,7% | o mesmo molde da Adoção: `golang:1.23-alpine` → `distroless/static-debian12:nonroot`, binário estático com as migrations embutidas, sem shell |
| `ampara/notificacoes` | 57,85 MB | 57,85 MB | <0,01% | `python:3.12-slim`, usuário não-root e dependências instaladas no builder. Medição de `docker image inspect` no runner Linux da [#41](execucao/notificacoes-validacao.md). |
| `ampara/assistente` | 233,2 MB | 233,2 MB | 0% | etapa `builder` em `python:3.12-slim` com virtualenv (sem o pip dele) → `runtime` com usuário não-root `appuser`. Sem ganho hoje: as dependências são só wheels prontos (FastAPI, uvicorn, pydantic-settings), que não deixam resíduo de build. O multi-stage passa a contar quando a #42 (LangChain e qdrant-client) trouxer dependências que compilam algo na instalação |
| `ampara/bff-web` | 336 MB | 261 MB | −22,3% | etapas `deps` → `build` → `runtime` em `node:22-alpine`, `npm ci --omit=dev`, usuário `node`; sem TypeScript nem tsx na final. O ganho é menor porque o binário do `node` sozinho tem 123 MB; o código e as dependências somam 17 MB |
| `ampara/bff-mobile` | | | | |
| `ampara/gateway` | | | | |

As imagens da infraestrutura (`ampara/rabbitmq` e `ampara/mongo`) só acrescentam configuração à imagem oficial e não têm etapa de build.
