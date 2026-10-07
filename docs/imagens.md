# Tamanho das imagens

Cada dono preenche a linha da própria imagem ao criar o Dockerfile multi-stage (#38 a #45), medindo com `docker image ls`. A coluna "Ganho" é a redução do multi-stage em relação ao single-stage.

| Imagem | Single-stage | Multi-stage | Ganho | Observação |
| --- | ---: | ---: | ---: | --- |
| `ampara/identidade` | | | | |
| `ampara/animais` | | | | |
| `ampara/adocao` | 628 MB | 20,5 MB | −96,7% | etapa `golang:1.23-alpine` → `distroless/static-debian12:nonroot`; binário estático com as migrations embutidas, sem shell |
| `ampara/notificacoes` | | | | |
| `ampara/assistente` | | | | |
| `ampara/bff-web` | | | | |
| `ampara/bff-mobile` | | | | |
| `ampara/gateway` | | | | |

As imagens da infraestrutura (`ampara/rabbitmq` e `ampara/mongo`) só acrescentam configuração à imagem oficial e não têm etapa de build.
