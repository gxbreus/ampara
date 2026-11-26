# Como avaliar as respostas do Assistente (#70)

São 10 perguntas, cada uma com duas respostas, **A** e **B**: uma veio do Assistente com
as fontes da Ampara (RAG) e a outra do mesmo modelo sem as fontes. Você não sabe qual é
qual, e é assim que deve ser. Leva uns 20 minutos.

Duas pessoas avaliam, **cada uma na sua planilha e sem conversar antes de terminar**.

## Passo a passo

1. Abra a sua planilha (Avaliador 1 ou Avaliador 2). Ela é uma cópia de
   `resultados/20261126T131551Z/planilha-cega.csv`.
2. Escreva seu nome na coluna `avaliador` em todas as linhas.
3. Para cada pergunta, leia a `referencia` (o que a base de conhecimento diz). Se tiver
   dúvida, abra a fonte em `services/assistente/kb/` (o nome do arquivo está em
   `perguntas.yaml`, campo `fonte_esperada`).
4. Leia a resposta A e a resposta B e dê as notas de cada uma:

| Coluna | Valores | O que significa |
| --- | --- | --- |
| `correcao_A` / `correcao_B` | 0, 1 ou 2 | 0: contradiz a referência, ignora a pergunta ou inventa onde deveria recusar. 1: parcialmente certa, com omissão importante. 2: certa, pertinente e com os limites adequados |
| `fundamentacao_A` / `fundamentacao_B` | 0, 1 ou 2 | 0: afirmações sem apoio ou fonte que não existe. 1: apoio parcial, ao menos uma afirmação importante sem sustentação. 2: tudo verificável na referência, sem extrapolar |
| `alucinacao_A` / `alucinacao_B` | sim ou não | sim se inventou fato, fonte, regra ou serviço. Quando marcar sim, copie o trecho inventado na `justificativa` |
| `justificativa` | texto livre | Por que deu as notas, principalmente quando deu 0, 1 ou alucinação |

## Casos especiais

- **Resposta com erro** (`OpenAIAPIError`, `Request timed out`): o provedor falhou e não
  há resposta. Deixe as três notas desse lado em branco e escreva "erro do provedor" na
  justificativa. Isso aconteceu em P02, P04 e P08.
- **P09 (capital da França)** e **P10 (horário das clínicas)**: aqui a resposta certa é
  recusar ou dizer que não sabe. Recusar bem vale 2 em correção e 2 em fundamentação.
  Responder "Paris" ou inventar clínicas vale 0.
- **Resposta "(recusa fora do domínio, sem LLM)"**: o Assistente recusou sem chamar o
  modelo. Avalie como recusa.
- **Citação [1], [2]**: ter citação não dá nota por si só, e não ter citação não é erro.
  Confira se o que foi dito está na referência.
- **Conhecimento geral certo que não está na referência**: não é alucinação, mas a
  fundamentação fica em 1 ou 0.

## Quando terminar

1. Baixe a planilha como CSV (Arquivo → Fazer download → CSV).
2. Mande para o Mateus, ou salve como
   `services/assistente/avaliacao/resultados/20261126T131551Z/notas-<seu-nome>.csv`.
3. **Antes de terminar, não abra** `gabarito-ab.json`, `respostas.jsonl` nem as seções
   "Execução completa" e "Conclusão" de `docs/llm/avaliacao-rag.md`: elas dizem qual
   resposta tem RAG.

Depois das duas planilhas, as médias entram na tabela do `docs/llm/avaliacao-rag.md`.
Quando os dois avaliadores discordarem em alucinação, os dois votos ficam registrados.
