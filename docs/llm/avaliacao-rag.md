# Avaliação do RAG — protocolo preparado, #70 pendente

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

Os runners `avaliar.py` e `medir_carga.py` ainda não foram implementados:
dependem dos pontos reais de integração das #67/#69. Os comandos sugeridos
na issue não são executáveis nesta branch e não há resultados para comparar.

No dia da medição, consultar e datar o preço oficial do modelo. Custo de API
por chamada é tokens de entrada × tarifa de entrada + tokens de saída × tarifa
de saída, com unidade por milhão convertida corretamente. Somar todas as
tentativas efetivamente cobradas e registrar separadamente embeddings locais
e custo operacional não medido. Projetar para 1 mil, 10 mil e 100 mil perguntas
com taxa de hit explicitada. Não tratar estimativa da ADR-007 como custo medido.

## Registro pendente e critérios de conclusão

| Item | Estado verificado em 2026-11-17 |
| --- | --- |
| Dez perguntas e categorias | Preparadas; gabaritos aguardam conferência nas fontes |
| Base e duas ingestões reais | #66 pendente de #42 integrada e Qdrant/Ollama disponíveis |
| Execução com e sem RAG | Depende da #67 |
| Cache, recuperação e falhas observáveis | Depende da #69 |
| Dois avaliadores e médias | Não realizadas |
| p50/p95 e tokens | Não medidos |
| Resultados brutos e conclusão qualitativa | Não disponíveis |

Só escrever onde o RAG ajudou, falhou e precisa melhorar após analisar os
resultados reais. Não preencher tabelas com números ilustrativos. Esta
contribuição usa `Refs #70`; a issue permanece aberta.
