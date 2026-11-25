# Tamanho das imagens

Cada dono preenche a linha da própria imagem ao criar o Dockerfile multi-stage (#38 a #45), medindo com `docker image ls`. A coluna "Ganho" é a redução do multi-stage em relação ao single-stage.

| Imagem | Single-stage | Multi-stage | Ganho | Observação |
| --- | ---: | ---: | ---: | --- |
| `ampara/identidade` | 511 MB | 325 MB | −36,4% | etapas `deps` → `build` → `runtime` em `node:22-alpine`, `npm ci --omit=dev`, usuário `node`; só `dist/` e dependências de produção na final, sem `src/` nem TypeScript |
| `ampara/animais` | 215 MB | 185 MB | −14,0% | etapa `builder` em `python:3.12-slim` com virtualenv isolado → `runtime` sem resíduos de cache de instalação, com usuário não-root `appuser` |
| `ampara/adocao` | 628 MB | 20,5 MB | −96,7% | etapa `golang:1.23-alpine` → `distroless/static-debian12:nonroot`; binário estático com as migrations embutidas, sem shell |
| `ampara/orquestrador` | 645 MB | 21,2 MB | −96,7% | o mesmo molde da Adoção: `golang:1.23-alpine` → `distroless/static-debian12:nonroot`, binário estático com as migrations embutidas, sem shell |
| `ampara/notificacoes` | 233,2 MB | 233,2 MB | 0% | etapa `builder` em `python:3.12-slim` com virtualenv (sem o pip dele) → `runtime` com usuário não-root `appuser`. Sem ganho hoje: as dependências são só wheels prontos (FastAPI, uvicorn, pydantic-settings), que não deixam resíduo de build. O multi-stage passa a contar quando a #41 trouxer dependências que compilam algo na instalação |
| `ampara/assistente` | 233,2 MB | 233,2 MB | 0% | etapa `builder` em `python:3.12-slim` com virtualenv (sem o pip dele) → `runtime` com usuário não-root `appuser`. Sem ganho hoje: as dependências são só wheels prontos (FastAPI, uvicorn, pydantic-settings), que não deixam resíduo de build. O multi-stage passa a contar quando a #42 (LangChain e qdrant-client) trouxer dependências que compilam algo na instalação |
| `ampara/bff-web` | 336 MB | 261 MB | −22,3% | etapas `deps` → `build` → `runtime` em `node:22-alpine`, `npm ci --omit=dev`, usuário `node`; sem TypeScript nem tsx na final. O ganho é menor porque o binário do `node` sozinho tem 123 MB; o código e as dependências somam 17 MB |
| `ampara/bff-mobile` | 384 MB | 270 MB | −29,7% | mesmo molde do BFF Web: `deps` → `build` → `runtime` em `node:22-alpine`, `npm ci --omit=dev`, usuário `node`. O single-stage foi medido com `--target build`, que tem TypeScript e as dependências de desenvolvimento |
| `ampara/gateway` | — | 520 MB | — | sem multi-stage, porque não há etapa de build: a imagem só instala o `envsubst` (`gettext-base`) e acrescenta o `kong.template.yml` e o script que gera o `kong.yml` na subida, sobre a `kong:3.8` oficial; roda como usuário `kong` |

As imagens da infraestrutura (`ampara/rabbitmq` e `ampara/mongo`) só acrescentam configuração à imagem oficial e não têm etapa de build.
