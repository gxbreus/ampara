# Apresentação da Parte 2

- **PDF:** [`ampara-parte2.pdf`](ampara-parte2.pdf), com 15 slides.
- **Original no Canva:** https://www.canva.com/d/az_pANzb4NIxwIr. Para editar, peça acesso ao Mateus.

| # | Slide | Tópico do enunciado | Quem apresenta | Documento de referência |
| --- | --- | --- | --- | --- |
| 1 | Capa | — | todos | — |
| 2 | Conectando protetores e adotantes | — | Mateus | [`requisitos.md`](../../requisitos.md) |
| 3 | Visão geral: componentes | 4.1 | Mateus | [`arquitetura.md`](../../arquitetura.md) |
| 4 | Por que este corte | 4.1 | cada um, o próprio serviço | [`arquitetura.md`](../../arquitetura.md), seção 3 |
| 5 | Gateway e versionamento | 4.2 e 4.3 | Gabriel Soares | `gateway.md` (#27), ADR-005 e ADR-006 (#28) |
| 6 | Contratos REST e Identidade | 4.2 | Gabriel Soares | `identidade.v1.yaml` (#20) |
| 7 | BFF Web × BFF Mobile | 4.4 | Gabriel Cantanhede e Mateus | [`bff-comparacao.md`](../../contratos/bff-comparacao.md) |
| 8 | Database per service e consistência | 4.5 | Gabriel Cantanhede | [`dados.md`](../../dados.md) |
| 9 | CQRS em Animais | 4.7 | Gabriel Cantanhede | `cqrs.md` e ADR-004 (#33) |
| 10 | SAGA: o caminho da adoção | 4.6 | Mateus | [`saga.md`](../../saga.md) e [ADR-002](../../decisoes/ADR-002-saga-orquestrada.md) |
| 11 | SAGA: falha, compensação e outbox | 4.5 e 4.6 | Mateus | [`saga.md`](../../saga.md), [ADR-003](../../decisoes/ADR-003-outbox.md) |
| 12 | Assistente: por que isolado | 4.1 | Gabriel Nakazato | ADR-007 (#35) |
| 13 | Assistente: como uma pergunta é respondida | 4.1 | Gabriel Nakazato | `assistente.v1.yaml` (#24) |
| 14 | Notificações e HATEOAS | 4.2 | Gabriel Nakazato e Mateus | `notificacoes.v1.yaml` (#23) e [`adocao.v1.yaml`](../../contratos/adocao.v1.yaml) |
| 15 | Encerramento | — | todos | — |

Os slides 5, 6, 9, 12, 13 e parte do 14 foram montados a partir dos PRs e das issues dos donos. Cada dono revisa o próprio slide antes do ensaio: ele precisa bater com o documento que entrar na `develop`.
