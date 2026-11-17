# Ensaio e arguição da Parte 2

O [PDF de 15 slides](ampara-parte2.pdf) e o original no Canva já estão
listados no [índice da apresentação](README.md). Este roteiro complementa os
slides com falas, referências e registro de ensaios da #36.

Revisão documental de 17/11/2026: o congelamento de 21/10 já passou. Não há
registro de dois ensaios nesta pasta. O histórico comprova a presença do PDF
antes do congelamento: inclusão em `2b90534`, última alteração em `931d19f`
(08/10/2026), presente na main em `8e40471` (13/10/2026). O blob
`d2a39ba6c1399852818a7691c62c0d7e3b4d91aa` é o mesmo nessa main histórica,
na main e na develop consultadas em 17/11. Isso comprova o arquivo no Git,
não os ensaios nem o envio por outro canal. Ajustes atuais têm data atual.

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

### Gabriel: slides 12–14 e decisões atuais

Fala preparada em 17/11, referenciando as branches próprias das #23, #24 e #35
ainda pendentes de publicação/merge. Não apresentar um contrato fora de develop
como entrega integrada.

- Slide 12: "O Assistente isola latência, custo e falhas do LLM. Qdrant guarda
  a base vetorial persistente; Redis dedicado guarda cache descartável. Não
  compartilho esse Redis com a caixa de notificações. O kickoff escolheu Groq,
  Ollama como opção local e embeddings multilíngues locais; a ADR-007 registra
  os limites e a estimativa, sem afirmar qualidade ou latência já medidas."
- Slide 13: "Perguntas seguem recuperação de até quatro trechos e geração com
  fontes. Recomendações usam tool na busca de Animais e só podem citar IDs
  realmente disponíveis. O servidor aplica localização; o LLM não recebe nem
  escolhe coordenadas. Cache, timeout, retry seletivo, circuito e fallback são
  responsabilidade do serviço; uma falha de geração não interrompe a SAGA."
- Slide 14: "Notificações consome adocao.* e conta.verificada. O responsável
  recebe nova solicitação em aguardando aprovação; os encerramentos respeitam
  as compensações. A caixa vem do sub do JWT, com cursor e filtro. Marcar lida
  é idempotente e retorna 204; item alheio retorna 404. AOF e volume preservam
  a caixa; deduplicação impede aviso repetido na reentrega. HATEOAS pertence à
  solicitação de Adoção e será explicado pelo Mateus."

O PDF histórico ainda precisa de revisão visual para refletir a ADR-008 nos
slides da SAGA. Correção da fala não equivale a correção do PDF. Atualizar o
original compartilhado e exportar nova revisão identificada, preservando o
registro da entrega de outubro; não afirmar que a versão corrigida já existia.

Perguntas extras para arguição do Gabriel (sortear outro colega para responder):

| Pergunta | Evidência que a resposta deve apontar |
| --- | --- |
| Por que chave LLM inválida não deve retirar todos os pods do Service? | readiness só de Qdrant/Redis e fallback nas #42/#69 |
| Um hit de cache de outra versão da base pode ser reutilizado? | chave com versão da base e modelo na #69 e ADR-007 da #35 |
| Como provar que o agente não inventou um animal? | IDs e disponibilidade comparados com o retorno da tool na #68 |
| Qual diferença entre falha do LLM e pergunta sem cobertura? | degradado/fallback versus orientação de domínio no contrato #24 |
| AOF everysec garante perda zero em qualquer falha? | política de fsync e teste de persistência da #41; não confundir com transação da adoção |

### Pendências conscientes da Parte 2

Registro atual, **não reconstrução de uma decisão tomada em outubro**:

| Issue | Situação em 17/11/2026 e ação necessária |
| --- | --- |
| #23 | Contrato validado localmente na branch docs/contrato-notificacoes; publicar, revisar e integrar. |
| #24 | Contrato validado localmente na branch docs/contrato-assistente; revisar também a adaptação do BFF Mobile. |
| #35 | ADR preparada na branch docs/adr-assistente; revisar escolhas e estimativa com hipóteses explícitas. |
| #34 | Conferir o estado da issue e a revisão da arquitetura com o responsável; não encerrar pelo fato de existir documento. |
| #36 | PDF histórico identificado; dois ensaios e revisão dos slides atualizados ainda sem evidência. |

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
- [x] PDF e commits anteriores ao congelamento identificados, com blob verificável.
- [x] Presença desse mesmo PDF na main histórica verificada no Git, sem alterar o arquivo.
