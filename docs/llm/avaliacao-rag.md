# Avaliação do RAG — protocolo, runner e primeira medição

Preparação de 2026-11-17, branch `feature/assistente-avaliacao`. Não há respostas
geradas, notas humanas, tokens ou latências medidas nesta entrega. As perguntas
estão em `services/assistente/avaliacao/perguntas.yaml`; `referencia: null`
significa trabalho a preencher a partir da fonte, não resposta vazia válida.
As fontes indicadas estão na branch da #66, `feature/assistente-ingestao`, ainda
não integrada. Perguntas e rubrica precisam de revisão antes da execução.

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
apenas depois da realização. Nenhuma avaliação humana foi feita aqui.

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

Saídas brutas em `/tmp/avaliacao/<data>/` dentro do container (copie com `kubectl cp`):

- `execucao.json`: data, modelo, versão da base, embeddings, limiar e temperatura;
- `respostas.jsonl`: uma linha por pergunta e modo (`com_rag` / `sem_rag`), com trechos
  recuperados e similaridade, resposta, tempos de recuperação e geração e tokens reais
  devolvidos pela API (ausentes ficam ausentes, nunca zero);
- `planilha-cega.csv`: respostas A/B embaralhadas por pergunta, com as colunas da rubrica,
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

## Registro pendente e critérios de conclusão

| Item | Estado verificado em 2026-11-25 |
| --- | --- |
| Dez perguntas e categorias | Preparadas; gabaritos aguardam conferência nas fontes |
| Base e duas ingestões reais | Ingestão implementada (fastembed + Qdrant); 15 trechos indexados no cluster em 25/11 |
| Execução com e sem RAG | Runner pronto; recuperação medida em 25/11; geração aguarda `LLM_API_KEY` |
| Cache, recuperação e falhas observáveis | Implementados (#69): `GET /v1/estado` mostra circuito, falhas, fallbacks e cache hits |
| Dois avaliadores e médias | Não realizadas |
| p50/p95 e tokens | Runner pronto (`--latencia N`); não medidos sem a chave |
| Resultados brutos e conclusão qualitativa | Não disponíveis |

Só escrever onde o RAG ajudou, falhou e precisa melhorar após analisar os
resultados reais. Não preencher tabelas com números ilustrativos. Esta
contribuição usa `Refs #70`; a issue permanece aberta.
