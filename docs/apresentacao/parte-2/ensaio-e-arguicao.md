# Ensaio e arguição da Parte 2

O [PDF de 15 slides](ampara-parte2.pdf) e o original no Canva já estão
listados no [índice da apresentação](README.md). Este roteiro complementa os
slides com falas, referências e registro de ensaios da #36.

Revisão documental de 17/11/2026: o congelamento de 21/10 já passou. Não há
registro de dois ensaios nesta pasta. Este documento não comprova que eles
aconteceram nem que o PDF atual corresponde ao arquivo entregue em outubro.
Anexe somente evidências históricas reais; ajustes atuais precisam de data atual.

## Ordem e tempo de fala (12 minutos)

| Tempo | Slides | Quem | Ideia principal | Referência |
| --- | --- | --- | --- | --- |
| 0:00–1:00 | 1–2 | Mateus | problema, público e fluxo da adoção | [Requisitos](../../requisitos.md) |
| 1:00–2:00 | 3–4 | todos, 15 s cada | cada dono explica seu limite e um corte rejeitado | [Arquitetura](../../arquitetura.md) |
| 2:00–3:15 | 5–6 | Gabriel Soares | JWT, rotas, versão e contrato de Identidade | [Gateway](../../gateway.md), [contrato](../../contratos/identidade.v1.yaml) |
| 3:15–4:15 | 7 | Gabriel Cantanhede e Mateus | mesmo Thor, oito campos mobile e contexto extra no web | [Comparação](../../contratos/bff-comparacao.md) |
| 4:15–5:00 | 8 | Gabriel Cantanhede | propriedade dos dados, bancos isolados e atraso entre réplicas | [Dados](../../dados.md) |
| 5:00–6:00 | 9 | Gabriel Cantanhede | bancos distintos de escrita/leitura e projeção reconstruível | [CQRS](../../cqrs.md) |
| 6:00–8:15 | 10–11 | Mateus | reserva, perfil, decisão humana, confirmação e compensações | [SAGA](../../saga.md), [ADR-008](../../decisoes/ADR-008-orquestrador.md) |
| 8:15–10:30 | 12–13 | Gabriel Nakazato | RAG, tool e isolamento das falhas do modelo | [LLM](../../llm/README.md) |
| 10:30–11:30 | 14 | Gabriel Nakazato e Mateus | avisos assíncronos e ações descobertas por links | [Adoção](../../contratos/adocao.v1.yaml) |
| 11:30–12:00 | 15 | todos | entregas existentes e próximos testes | [Planejamento](../../planejamento.md) |

Não leia texto corrido. Em cada trecho: descreva uma decisão, mostre a referência
e explique a consequência quando um serviço cai. Se o slide antigo disser que
Adoção coordena a SAGA, explicite a mudança da ADR-008: o Orquestrador coordena;
Adoção guarda a solicitação, decisão humana e o espelho das transições.

## Arguição cruzada

Sorteie alguém que não seja dono do tópico. Dê 60 s para responder e 30 s para
o dono apontar lacunas. Todos devem responder pelo menos uma pergunta de SAGA.

| Pergunta | Resposta precisa incluir | Onde conferir |
| --- | --- | --- |
| Por que separar Orquestrador e Adoção? | coordenação durável, decisão humana no domínio e evolução independente | [ADR-008](../../decisoes/ADR-008-orquestrador.md) |
| Quem pode mudar o animal para RESERVADO? | participante Animais, atualização condicional, reserva vinculada à SAGA | [SAGA §7](../../saga.md#7-defesa-nos-participantes) |
| O que o 202 confirma? | aceite do comando; resultado assíncrono acompanhado por Location e links | [Contrato Adoção](../../contratos/adocao.v1.yaml) |
| Por que o botão cancelar desaparece? | domínio deixa de anunciar a ação; cliente segue o link recebido | [Contrato Adoção](../../contratos/adocao.v1.yaml) |
| Onde se verifica assinatura, role e dono do recurso? | gateway, BFF e serviço, respectivamente; serviços também validam JWT | [Gateway](../../gateway.md) |
| Por que o mobile não recebe o endereço exato? | privacidade e payload; projeção só tem ponto aproximado | [CQRS](../../cqrs.md) |
| CQRS exige duas máquinas? | dois modelos/bancos; instância compartilhada no MVP, URLs independentes | [CQRS](../../cqrs.md) |
| O outbox elimina duplicatas? | não; publicação ao menos uma vez, inbox/versão tornam efeito idempotente | [Dados §5](../../dados.md#5-outbox-e-inbox) |
| E se o relay cair após publicar e antes de marcar enviado? | republicação; consumidor não repete efeito | [Dados](../../dados.md) |
| E se LiberarReserva chegar antes de ReservarAnimal? | marca persistente de compensação; reserva tardia recebe SAGA_ENCERRADA | [SAGA §7](../../saga.md#7-defesa-nos-participantes) |
| Quando se conclui uma compensação? | respostas bloqueantes recebidas; não basta publicar comandos | [SAGA §4](../../saga.md#4-compensações-por-cenário) |
| O que muda após o pivô? | aprovação humana; confirmações são repetidas até concluir | [SAGA §2](../../saga.md#2-passos) |
| O que acontece se o Orquestrador reiniciar? | estado durável, outbox pendente e prazos retomados | [SAGA §6](../../saga.md#6-regras-do-orquestrador) |
| Por que isolar o Assistente? | custo, latência, disponibilidade e mecanismos próprios de resiliência | [LLM](../../llm/README.md) |

## Registro de ensaios

Campos sem evidência ficam pendentes. Registre a duração real, sem arredondar
para caber na meta, e cite o commit do material usado.

| Ensaio | Data/hora | Participantes | Duração | Arguição cruzada | Problemas e correções | Evidência/commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | pendente | pendente | pendente | pendente | pendente | pendente |
| 2 | pendente | pendente | pendente | pendente | pendente | pendente |

## Cobertura e conferência final

| Tópico | Slides | Documento |
| --- | --- | --- |
| 4.1 Decomposição | 3–4, 12–13 | arquitetura e LLM |
| 4.2 REST | 5–6, 14 | contratos e versionamento |
| 4.3 Gateway | 5 | gateway |
| 4.4 BFFs | 7 | comparação do mesmo animal |
| 4.5 Dados e outbox | 8, 11 | dados |
| 4.6 SAGA | 10–11 | saga e ADR-008 |
| 4.7 CQRS | 9 | cqrs |

- [ ] Os quatro integrantes revisaram sua fala e as dos colegas.
- [ ] Dois ensaios reais registrados; um contém arguição cruzada.
- [ ] Slides não prometem testes que ainda não foram executados.
- [ ] Issues/PRs pendentes da Parte 2 listados com decisão consciente.
- [ ] PDF e commit da entrega original identificados, com data verificável.
- [ ] Integração em main verificada pelo responsável, sem alterar retroativamente o histórico.
