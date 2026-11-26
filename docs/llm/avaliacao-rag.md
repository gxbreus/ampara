# Avaliação do RAG — protocolo, runner e medições

Protocolo e perguntas preparados em 2026-11-17; runner e primeiras medições em
2026-11-25; referências, preços oficiais, execução completa e avaliação humana cega em
2026-11-26. As perguntas estão em
`services/assistente/avaliacao/perguntas.yaml`, cada uma com a referência resumida do
texto da fonte esperada em `services/assistente/kb/` (nunca de resposta do LLM). Os
avaliadores conferem a referência na fonte antes de dar as notas.

## Método de comparação

Depois de integrar #66, #67 e #69, fixar commit, versão da base, modelos de
embeddings e geração, parâmetros, temperatura e corpus de perguntas. Registrar
SO, CPU, RAM, containers, rede e versões. Cada pergunta deve passar pelo mesmo
modelo com e sem recuperação; a função sem RAG fica só no avaliador, nunca na
API pública. Preservar saídas brutas e o prompt efetivamente usado, removendo
segredos e dados pessoais.

Dois integrantes preparam/conferem as referências diretamente nas fontes
indicadas, com seção/página. Não usar resposta do próprio LLM como gabarito.
Para perguntas fora do domínio e sem cobertura, avaliar a recusa/orientação
esperada, sem exigir uma resposta factual fora da base. As políticas de
instituições externas não devem virar regras universais ou da Ampara.

Apresentar respostas com identificadores cegos, sem informar aos avaliadores
qual veio com RAG. Cada avaliador registra suas notas independentemente antes
de discutir divergências. Guardar ambas as avaliações originais; eventual
consenso posterior é um campo separado e não substitui os registros.

## Rubrica para dois avaliadores humanos

| Critério | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Correção | Contradiz a referência, ignora a pergunta ou inventa resposta onde deveria recusar | Parcialmente correta, com omissão relevante | Correta, pertinente e com limites adequados; recusa apropriada nos controles |
| Fundamentação | Afirmações sem apoio ou fonte inexistente/incompatível | Apoio parcial; ao menos uma afirmação importante não sustentada | Afirmações verificáveis nas referências, sem extrapolar contexto ou regras locais |

Alucinação: **sim/não**, com trecho e justificativa obrigatórios quando sim.
Inclui fato, fonte, regra ou disponibilidade inventada. A referência deve
permitir conferir também respostas sem RAG: não dar ponto automaticamente só
pela presença de citação e não presumir erro só porque não há citação. Para
controle fora do domínio/sem cobertura, fundamentação 2 significa reconhecer
corretamente o limite e não inventar fonte.

Por pergunta e modo, calcular média de correção e fundamentação entre os dois
avaliadores. Para alucinação, preservar ambos os votos e registrar proporção
de votos positivos e concordância; não converter discordância em um "não".
Divulgar identificação dos avaliadores, data e versão das saídas avaliadas
apenas depois da realização. Realizada em 26/11 por Gabriel Soares e Gabriel Cantanhede,
sobre as saídas de `resultados/20261126T131551Z/` (seção "Avaliação humana cega").

## Latência, tokens e custo

O runner da entrega posterior deve registrar por chamada: ID, modo, cache hit,
degradado, fontes recuperadas/usadas, resposta, tokens reais de entrada/saída,
tempo de recuperação, geração e total, erro e parâmetros de execução.
Tokens ausentes ficam desconhecidos, nunca zero estimado como medição. A
geração sem RAG não tem recuperação; representar essa etapa como não aplicável.
Em cache hit não atribuir a latência da geração original à requisição atual.

Medir N=50 chamadas por cenário com e sem cache. Declarar se o cache frio foi
isolado por namespace/versão ou se cada pergunta foi inédita; não limpar dados
de Notificações. Separar sucessos normais, fallback e falhas ao apresentar
p50/p95; reportar todas as contagens e não descartar erros silenciosamente.
Usar percentil por posto mais próximo (`ceil(p*N)` na série ordenada, índice
começando em 1), documentando warm-up excluído e concorrência utilizada.

O runner `avaliar.py` foi implementado em 25/11 (veja "Como rodar"); a medição de
latência está nele (`--latencia N`), em vez de um `medir_carga.py` separado.

No dia da medição, consultar e datar o preço oficial do modelo. Custo de API
por chamada é tokens de entrada × tarifa de entrada + tokens de saída × tarifa
de saída, com unidade por milhão convertida corretamente. Somar todas as
tentativas efetivamente cobradas e registrar separadamente embeddings locais
e custo operacional não medido. Projetar para 1 mil, 10 mil e 100 mil perguntas
com taxa de hit explicitada. Não tratar estimativa da ADR-007 como custo medido.

## Como rodar (runner implementado em 25/11)

O runner é `services/assistente/app/avaliar.py` (o `avaliar.py` previsto acima). Ele roda
dentro do container do Assistente, que já tem a base, as perguntas e o modelo de
embeddings:

```bash
kubectl exec -it deploy/assistente -n ampara -- python -m app.avaliar
# com a medição de latência (N chamadas por cenário, cache frio e quente):
kubectl exec -it deploy/assistente -n ampara -- python -m app.avaliar --latencia 50
# com custo, só depois de consultar e datar o preço oficial do modelo:
kubectl exec -it deploy/assistente -n ampara -- python -m app.avaliar \
  --preco-entrada <US$/1M tokens> --preco-saida <US$/1M tokens> --preco-data AAAA-MM-DD
```

Saídas brutas em `/tmp/avaliacao/<data>/` dentro do container. Para versionar, copie
para `services/assistente/avaliacao/resultados/<data>/` (`kubectl cp` ou, no Compose,
`docker compose cp assistente:/tmp/avaliacao/<data> services/assistente/avaliacao/resultados/`):

- `execucao.json`: data, modelo, versão da base, embeddings, limiar e temperatura;
- `respostas.jsonl`: uma linha por pergunta e modo (`com_rag` / `sem_rag`), com trechos
  recuperados e similaridade, resposta, tempos de recuperação e geração e tokens reais
  devolvidos pela API (ausentes ficam ausentes, nunca zero);
- `planilha-cega.csv`: respostas A/B embaralhadas por pergunta, com a referência e as colunas da rubrica,
  para os dois avaliadores humanos preencherem de forma independente;
- `gabarito-ab.json`: qual resposta é com e sem RAG, para abrir só depois das notas;
- `latencia.json` (com `--latencia`): p50/p95 por posto mais próximo e contagem de normal,
  cache, fallback e erro.

Modelo de embeddings: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
(fastembed, 384 dimensões, CPU), embutido na imagem. Substitui o `bge-m3` via Ollama, que
não cabia na máquina da demo (sem GPU e com pouca RAM livre). Geração: Groq,
`openai/gpt-oss-120b` com `llama-3.1-8b-instant` de reserva (decisão 7 do
`requisitos.md`); o modelo efetivo fica registrado em `execucao.json`.

## Primeira medição (25/11/2026, sem chave do LLM)

Execução real do runner, base `ae06f1c860d3` (15 trechos), limiar 0,30, 3 trechos. Sem
`LLM_API_KEY`, só a recuperação foi medida; geração, tokens, latência e custo ficam para a
execução com a chave.

| Pergunta | Fonte esperada | 3 primeiras recuperadas | Maior similaridade |
| --- | --- | --- | --- |
| P01 | 06-vacinacao.md | **06-vacinacao.md**, 13-vacinacao-abrigos.md, 03-planejamento.md | 0,57 |
| P02 | 11-adote-gatinho.md | **11-adote-gatinho.md**, 10-adocao-sp.md, 04-resgate.md | 0,53 |
| P03 | 03-planejamento.md | 05-adaptacao.md, 04-resgate.md, 02-lei-14064.md | 0,48 |
| P04 | 05-adaptacao.md | **05-adaptacao.md**, 15-ampara-limites.md, 04-resgate.md | 0,54 |
| P05 | 04-resgate.md | **04-resgate.md**, 15-ampara-limites.md, 05-adaptacao.md | 0,69 |
| P06 | 02-lei-14064.md | 01-lei-9605.md, **02-lei-14064.md**, 12-servicos-dvz.md | 0,85 |
| P07 | 14-ampara-faq.md | **14-ampara-faq.md**, 09-errata-mpdft.md, 15-ampara-limites.md | 0,74 |
| P08 | 08-sgpan-guarda.md | **08-sgpan-guarda.md**, 07-arca-guarda.md, 04-resgate.md | 0,59 |
| P09 (fora do domínio) | — | (abaixo do limiar: recusada sem LLM) | 0,10 |
| P10 (sem cobertura) | — | 12-servicos-dvz.md, 02-lei-14064.md, 06-vacinacao.md | 0,44 |

- **Fonte esperada em 1º lugar: 6 de 8; entre as 3 primeiras: 7 de 8.**
- **P03 é a falha:** "só o porte determina se o cão combina com a rotina?" recupera
  adaptação e resgate, e não o texto de planejamento. A pergunta fala de rotina e casa, e o
  trecho de planejamento usa outro vocabulário; é um caso para revisar o texto da base ou
  testar um modelo de embeddings maior.
- **P09 separa bem:** a pergunta fora do domínio tem similaridade 0,10, contra 0,48 ou mais
  das perguntas da base, e é recusada antes de chamar o LLM.
- **P10 passa do limiar (0,44) sem ter cobertura real:** quem evita a invenção é o prompt
  ("se as fontes não cobrirem, diga que não cobrem; nunca invente clínicas ou horários"),
  e isso só é verificável na execução com o LLM.

## Execução com o LLM (25/11/2026, `gemini-2.5-flash-lite`)

Execução real do runner (`--pausa 4 --latencia 10`), base `ae06f1c860d3`, 4 trechos,
temperatura 0,2, fora do cluster (mesmo código, base, embeddings e modelo; dentro do pod a
segunda cópia do modelo de embeddings estourou o limite de memória). **A cota gratuita do
Gemini é de 20 requisições por dia por modelo**: ela acabou no meio da execução, então 9
chamadas voltaram 429 e estão registradas como erro, não descartadas.

| Pergunta | Com RAG: checagem de citação | Fontes citadas | Geração (ms) | Tokens (entrada/saída) | Sem RAG |
| --- | --- | --- | --- | --- | --- |
| P01 vacinação de filhote | ok | 06, 13, 04, 03 | 1.477 | 592/119 | respondeu (811 ms, 86/100) |
| P02 janelas e gatos | ok | 10, 04, 11 | 737 | 621/78 | 429 |
| P03 porte e rotina | **sem cobertura** | — | 683 | 608/86 | respondeu (1.073 ms, 83/90) |
| P04 apresentar a outros animais | 429 | — | — | — | 429 |
| P05 cão abandonado | ok | 04 | 787 | 603/75 | 429 |
| P06 Lei 14.064 | ok | 02, 01 | 1.029 | 669/107 | 429 |
| P07 aceite ≠ adoção concluída | ok | 14 | 692 | 614/67 | 429 |
| P08 viagens | 429 | — | — | — | 429 |
| P09 capital da França | recusa sem LLM (similaridade 0,10) | — | 0 | — | 429 |
| P10 horário das clínicas | **sem cobertura** | — | 782 | 608/49 | respondeu (608 ms, 81/60) |

**Observações (conferidas nas fontes; ainda não substituem a avaliação humana cega):**

- **Todas as 7 respostas com RAG passaram na checagem de citação** (5 citando fontes que
  existem e 2 declarando sem cobertura). Nenhuma citou fonte inexistente.
- **P06 é fundamentada:** "parágrafo 1º-A, reclusão de dois a cinco anos, multa e proibição
  da guarda" está literalmente em `kb/02-lei-14064.md`.
- **P10 se comportou como o protocolo pede:** com RAG, disse que as fontes não cobrem e não
  inventou clínicas nem horários. Sem RAG, também não inventou ("não tenho acesso a
  informações em tempo real").
- **P03 mostra o custo de uma recuperação ruim:** como a busca não trouxe
  `03-planejamento.md` (o erro de recuperação já registrado acima), o modelo com RAG
  respondeu "sem cobertura", enquanto sem RAG deu uma resposta plausível de conhecimento
  geral. Com RAG o erro é por omissão (seguro), não por invenção.
- **Tokens:** com RAG a entrada é ~7 vezes maior (≈600 contra ≈85 tokens), por causa dos 4
  trechos de contexto; a saída é parecida (≈50 a 120 tokens).
- **Custo:** no plano gratuito, US$ 0. O custo no plano pago não foi calculado porque o
  preço oficial do modelo não foi consultado e datado nesta execução (use `--preco-entrada`,
  `--preco-saida` e `--preco-data`).

**Latência (10 chamadas por cenário):** cache frio p50 5,9 s e p95 7,2 s; cache quente
p50 51 ms. **O cache frio está inflado:** as chamadas aconteceram no limite de requisições
por minuto do plano gratuito, e as novas tentativas com backoff (429) entram no tempo. Uma
chamada isolada ao `gemini-2.5-flash-lite` levou cerca de 1 s nos testes. Repetir a medição
com cota disponível (`--pausa 8` ou mais) antes de apresentar o número.

**Consequência para a operação:** com 20 requisições por dia por modelo, o Assistente usa
uma lista de reservas (`LLM_FALLBACK_MODEL`, um modelo por cota) e, quando um modelo
responde "cota diária excedida", o circuito dele abre por 1 hora e a próxima reserva assume
sem novas tentativas. Para a demo e a gravação, a alternativa sem limite apertado é ativar o
faturamento do projeto no Google AI Studio (o flash-lite custa frações de centavo por
pergunta).

## Execução completa (26/11/2026, `gemini-2.5-flash-lite`)

Execução real do runner (`--latencia 10 --pausa 8`), dentro da imagem do Assistente no
Compose, com o código desta branch; base `ae06f1c860d3` (15 trechos), 4 trechos por
resposta, limiar 0,30, temperatura 0,2. Máquina: notebook do grupo, Linux, CPU, sem
GPU, rede doméstica. Saídas brutas em
`services/assistente/avaliacao/resultados/20261126T131551Z/`.

**17 de 20 gerações concluídas.** Três falharam no provedor e estão registradas como erro,
não descartadas: P02 e P04 sem RAG (HTTP 503 do Gemini) e P08 com RAG (tempo esgotado).

| Pergunta | Com RAG: checagem de citação | Fontes citadas | Geração com RAG (ms) | Tokens com RAG | Geração sem RAG (ms) | Tokens sem RAG |
| --- | --- | --- | --- | --- | --- | --- |
| P01 vacinação de filhote | ok | 06, 13, 03 | 937 | 592/123 | 921 | 86/114 |
| P02 janelas e gatos | ok | 10, 04, 11 | 883 | 621/94 | erro 503 | — |
| P03 porte e rotina | sem cobertura | — | 1.363 | 608/85 | 872 | 83/89 |
| P04 apresentar a outros animais | ok | 05, 04 | 906 | 581/81 | erro 503 | — |
| P05 cão abandonado | ok | 04 | 1.099 | 603/84 | 821 | 87/79 |
| P06 Lei 14.064 | ok | 02, 01 | 6.773 | 669/126 | 5.160 | 98/114 |
| P07 aceite ≠ adoção concluída | ok | 14 | 1.345 | 614/66 | 8.015 | 87/86 |
| P08 viagens | tempo esgotado | — | — | — | 1.036 | 79/88 |
| P09 capital da França | recusa sem LLM (similaridade 0,10) | — | 0 | — | 644 | 73/27 |
| P10 horário das clínicas | sem cobertura | — | 604 | 608/47 | 788 | 81/60 |

Recuperação: fonte esperada em 1º lugar em 6 de 8 perguntas e entre as 3 primeiras em
7 de 8 (a falha continua sendo P03), igual à medição de 25/11.

**Tokens medidos (média das chamadas concluídas):** com RAG, 612 de entrada e 88 de saída;
sem RAG, 84 de entrada e 82 de saída. O contexto multiplica a entrada por ~7 e não muda
a saída.

### Latência

| Etapa | p50 | p95 | Observação |
| --- | --- | --- | --- |
| Recuperação (embedding + Qdrant) | 40 ms | 184 ms | 10 perguntas |
| Geração com RAG | 937 ms | 6.773 ms | 8 chamadas; o p95 é P06, com novas tentativas |
| Geração sem RAG | 872 ms | 8.015 ms | 8 chamadas; o p95 é P07, com novas tentativas |
| Total, cache frio (10 chamadas inéditas) | 2.209 ms | 9.541 ms | 10 normais, 0 fallback, 0 erro |
| Total, cache quente (10 repetições) | 23 ms | 2.803 ms | 9 do cache; o p95 é a 1ª chamada, que ainda não estava no cache |

A geração responde por quase todo o tempo: a recuperação fica abaixo de 200 ms. A cauda
(p95 de 7 a 9 s) vem dos 503 do plano gratuito: a resiliência (#69) tenta de novo com
backoff e o tempo das tentativas entra na conta. Uma chamada sem erro leva ~0,9 s.
Percentil por posto mais próximo, chamadas sequenciais, sem warm-up excluído.

### Custo

No plano gratuito do Gemini, que é o usado pelo grupo, o custo é **US$ 0**; o limite é de
20 requisições por dia por modelo, contornado com a lista de reservas
(`LLM_FALLBACK_MODEL`). Para a projeção em escala, usamos o preço do plano pago.

Preços oficiais de <https://aistudio.google.com/docs/pricing> (antes
`ai.google.dev/gemini-api/docs/pricing`), consultados em 2026-11-26; a página não mostra
data de atualização:

| Modelo | Entrada (US$/1M tokens) | Saída (US$/1M tokens) | Cache de contexto (US$/1M) |
| --- | --- | --- | --- |
| `gemini-2.5-flash-lite` (principal) | 0,10 | 0,40 | 0,01 + 1,00 por 1M tokens/hora |
| `gemini-3.5-flash-lite` (1ª reserva) | 0,30 | 2,50 | 0,03 + 1,00 por 1M tokens/hora |

Os embeddings rodam em CPU no próprio container (fastembed) e não têm custo de API.

Custo por pergunta = tokens de entrada × 0,10/1M + tokens de saída × 0,40/1M, com os
tokens medidos acima. Custo mensal = custo por pergunta × volume × (1 − taxa de acerto do
cache).

| Modo | Por pergunta | 1 mil/mês | 10 mil/mês | 100 mil/mês |
| --- | --- | --- | --- | --- |
| Com RAG, sem cache | US$ 0,000097 | US$ 0,10 | US$ 0,96 | US$ 9,64 |
| Com RAG, 30% de acerto do cache | — | US$ 0,07 | US$ 0,68 | US$ 6,75 |
| Sem RAG, sem cache | US$ 0,000041 | US$ 0,04 | US$ 0,41 | US$ 4,13 |

A taxa de 30% é uma hipótese, não uma medição: o cache exato só acerta perguntas
idênticas. Se o modelo de reserva assumir (cota do principal esgotada), o custo por
pergunta com RAG sobe para ~US$ 0,0004 (3,5 flash-lite). Também se consultou a Groq
(<https://console.groq.com/docs/models>, 26/11): `openai/gpt-oss-120b` a US$ 0,15 de
entrada e US$ 0,60 de saída por 1M; sem tokens medidos nela, não há custo calculado.

## Avaliação humana cega (26/11/2026)

Dois avaliadores, **Gabriel Soares** e **Gabriel Cantanhede**, preencheram a planilha cega
de forma independente, sem o gabarito A/B, seguindo `avaliacao/COMO-AVALIAR.md`. As notas
originais estão em `resultados/20261126T131551Z/notas-gabriel-soares.csv` e
`notas-gabriel-cantanhede.csv`; o modo de cada resposta vem de `gabarito-ab.json`. As
três gerações que falharam no provedor (P02 e P04 sem RAG, P08 com RAG) ficaram sem nota,
como manda o protocolo: 9 respostas com RAG e 8 sem RAG foram avaliadas.

| ID | Pergunta | Sem RAG: correção | Sem RAG: fundamentação | Sem RAG: alucinou? | Com RAG: correção | Com RAG: fundamentação | Com RAG: alucinou? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | vacinação de filhote | 1,5 | 1,0 | 0/2 | 2,0 | 1,0 | 0/2 |
| P02 | janelas e gatos | erro do provedor | — | — | 2,0 | 2,0 | 0/2 |
| P03 | porte e rotina | 1,5 | 1,0 | 0/2 | **0,0** | **0,0** | **2/2** |
| P04 | apresentar a outros animais | erro do provedor | — | — | 2,0 | 1,0 | 0/2 |
| P05 | cão abandonado | 1,5 | 1,0 | 0/2 | 2,0 | 2,0 | 0/2 |
| P06 | Lei 14.064 | 1,0 | 1,0 | 0/2 | 2,0 | 1,0 | 0/2 |
| P07 | aceite ≠ adoção concluída | 1,0 | 0,5 | **2/2** | 2,0 | 1,5 | 0/2 |
| P08 | viagens | 1,0 | 1,0 | 0/2 | erro do provedor | — | — |
| P09 | capital da França (fora do domínio) | **0,0** | **0,0** | 0/2 | 2,0 | 2,0 | 0/2 |
| P10 | horário das clínicas (sem cobertura) | 2,0 | 2,0 | 0/2 | 2,0 | 2,0 | 0/2 |

Notas de 0 a 2, média dos dois avaliadores; alucinação em votos "sim" sobre 2.

| Modo | Respostas | Correção | Fundamentação | Votos de alucinação |
| --- | --- | --- | --- | --- |
| **Com RAG** | 9 | **1,78** | **1,39** | 2 de 18 (P03) |
| **Sem RAG** | 8 | 1,19 | 0,94 | 2 de 16 (P07) |
| Com RAG, só as 7 perguntas com os dois modos | 7 | 1,71 | 1,36 | 2 de 14 |
| Sem RAG, só as 7 perguntas com os dois modos | 7 | 1,21 | 0,93 | 2 de 14 |

| Avaliador | Com RAG (correção / fundamentação) | Sem RAG (correção / fundamentação) |
| --- | --- | --- |
| Gabriel Soares | 1,78 / 1,44 | 1,38 / 1,00 |
| Gabriel Cantanhede | 1,78 / 1,33 | 1,00 / 0,88 |

**Concordância entre os avaliadores (17 respostas):** alucinação igual em 17 de 17; nota de
correção idêntica em 14 e de fundamentação em 15; nenhuma divergência maior que 1 ponto.
As três divergências de correção são todas sem RAG (P01, P03, P05: 2 contra 1), com o
Gabriel Cantanhede mais rigoroso com respostas de conhecimento geral que omitem pontos da
referência.

## Conclusão

Análise das respostas de 26/11, conferidas nas fontes da base e confirmada pela avaliação
humana cega acima. **Com RAG, a correção média subiu de 1,19 para 1,78 e a fundamentação
de 0,94 para 1,39**, com o mesmo número de alucinações (uma resposta em cada modo), mas de
naturezas diferentes: sem RAG o modelo inventou regras da Ampara; com RAG, a falha veio da
recuperação.

**Onde o RAG ajudou**

- **Regras da própria Ampara (P07).** Sem RAG, o modelo inventou etapas que a Ampara não
  tem ("visita ao lar, entrevista com a equipe e assinatura do termo"). Com RAG, descreveu o
  fluxo real: processo assíncrono, avaliação pelo responsável, liberação da reserva. É o
  caso mais claro: sem a base, o modelo não tem como saber as regras do sistema e preenche
  com o que é comum em ONGs.
- **Fora do domínio (P09).** Com RAG, a pergunta foi recusada antes do LLM (similaridade
  0,10), sem custo. Sem RAG, o modelo respondeu "Paris", fora do papel do assistente.
- **Precisão e rastreabilidade (P05, P06).** Com RAG, a resposta da Lei 14.064 cita o
  parágrafo 1º-A do artigo 32 e a pena exata, conferíveis em `02-lei-14064.md`; sem RAG o
  conteúdo central também estava certo, mas genérico ("outras sanções") e sem fonte.
- **Não prescrever (P01).** Com RAG, a resposta deixou o esquema vacinal ao veterinário,
  como a fonte; sem RAG, deu um calendário ("entre 6 e 8 semanas") que a base não traz.

**Onde não ajudou**

- **Recuperação errada vira afirmação falsa (P03).** A busca não trouxe
  `03-planejamento.md`, e a resposta com RAG declarou que as fontes não cobrem o assunto;
  sem RAG, a resposta geral estava correta (1,5). A leitura inicial era de um erro "seguro",
  por omissão, mas **os dois avaliadores deram 0 e marcaram alucinação**: afirmar que a
  base não cobre algo que ela cobre é uma informação falsa ao usuário. É a pior nota com
  RAG e o principal ponto a corrigir.
- **Sem cobertura (P10).** As duas versões se comportaram bem: com RAG pelo marcador
  `SEM_COBERTURA`, sem RAG por instrução do prompt. Aqui o RAG não fez diferença.
- **Extrapolação leve (P04).** A resposta com RAG puxou "aproximação com segurança, pois
  ele pode estar ferido" do texto de resgate para a apresentação a outros animais. A
  citação existe, mas o contexto é outro; a checagem de citação não pega esse tipo de erro.
- **Custo e cauda de latência.** O RAG multiplica os tokens de entrada por ~7 (US$ 0,000097
  contra US$ 0,000041 por pergunta), ainda irrelevante em valor absoluto. A latência é
  dominada pelo provedor, não pela recuperação.

**O que melhorar**

1. **Recuperação de P03 (prioridade):** reescrever o trecho de planejamento com o
   vocabulário de quem pergunta ("rotina", "casa", "combina") ou testar um modelo de
   embeddings maior. Rever também o texto do marcador `SEM_COBERTURA` para "não encontrei
   nas fontes recuperadas" em vez de afirmar que a base não cobre.
2. **Repetir as três chamadas que falharam** (P02 e P04 sem RAG, P08 com RAG) num dia com
   cota e sem 503, para fechar as 20 comparações.
3. **Cache semântico:** o cache exato só acerta perguntas idênticas; reaproveitar a
   resposta de perguntas equivalentes aumenta a taxa de acerto e reduz custo e latência
   (implementado no PR #216, com as travas medidas em `docs/llm/cache-semantico.md`).
4. **Checagem além da citação:** hoje ela só garante que [n] existe; P04 mostra que a
   citação pode estar fora de contexto.

## Registro pendente e critérios de conclusão

| Item | Estado verificado em 2026-11-26 |
| --- | --- |
| Dez perguntas e categorias | Prontas, com referência resumida da fonte, conferida pelos dois avaliadores |
| Base e duas ingestões reais | Ingestão implementada (fastembed + Qdrant); 15 trechos indexados no cluster em 25/11 |
| Execução com e sem RAG | Completa em 26/11 com `gemini-2.5-flash-lite`: 17 de 20 gerações; 3 erros do provedor registrados |
| Cache, recuperação e falhas observáveis | Implementados (#69): `GET /v1/estado` mostra circuito, falhas, fallbacks e cache hits |
| Dois avaliadores e médias | Feito em 26/11 (Gabriel Soares e Gabriel Cantanhede); médias, votos e concordância acima |
| p50/p95 e tokens | Medidos em 26/11 por etapa, com cache frio e quente |
| Preços oficiais e custo | Gemini consultado em 26/11; custo e projeção calculados com tokens medidos |
| Resultados brutos e conclusão qualitativa | `resultados/20261126T131551Z/` e seção "Conclusão" |

Todos os critérios de aceite da #70 estão atendidos. Limitação registrada: três das 20
gerações falharam no provedor (503 e tempo esgotado) e ficaram sem nota; repetir essas
chamadas fecharia as 10 comparações pareadas. Nenhum número deste doc é ilustrativo:
todos saem dos arquivos brutos em `resultados/20261126T131551Z/`.
