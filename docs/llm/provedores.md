# Provedores de LLM do Assistente e ordem de reserva

O Assistente tenta os modelos nesta ordem, cada um com o seu circuito (#69). Quando um
estoura a cota ou cai, o próximo assume; se todos falharem, a resposta é a contingência com
os próprios trechos da base (`degradado: true`).

| Ordem | Provedor | Modelos (padrão) | Chave | Custo |
| --- | --- | --- | --- | --- |
| 1 | Principal (`LLM_PROVIDER`) | Gemini: `gemini-2.5-flash-lite` e `gemini-2.5-flash` (`LLM_FALLBACK_MODEL`) | `LLM_API_KEY` | plano gratuito |
| 2 | Groq | `qwen/qwen3.8-27b`, `openai/gpt-oss-120b` (`GROQ_MODELS`) | `GROQ_API_KEY` | plano gratuito |
| 3 | OpenRouter | `nvidia/nemotron-3.5-super-vl:free`, `nvidia/nemotron-3.5-lightning:free`, `google/gemma-4-31b-it:free` (`OPENROUTER_MODELS`) | `OPENROUTER_API_KEY` | US$ 0 (modelos `:free`) |

As chaves de Groq e OpenRouter são opcionais: vazias, o provedor fica fora da lista. O
mesmo modelo no mesmo provedor só entra uma vez. `LLM_ORDEM` muda a ordem dos grupos
(`principal`, `groq`, `openrouter`); para a demo, `LLM_ORDEM=groq,principal,openrouter`
põe a Groq na frente, porque no plano gratuito do Gemini o 2.5-flash chegou a passar de
12 s e a recomendação estourava os 20 s do BFF.

## Onde pegar as chaves

- **Groq:** <https://console.groq.com/keys> → Create API Key. Os limites da conta ficam em
  <https://console.groq.com/settings/limits>.
- **OpenRouter:** <https://openrouter.ai> → Keys → Create Key, com limite de crédito 0: os
  modelos `:free` custam US$ 0 e um modelo pago por engano é recusado em vez de cobrado.
  Limites dos `:free` (<https://openrouter.ai/docs/api/reference/limits>, 26/11): 20
  requisições por minuto e 50 por dia; 1.000 por dia depois de US$ 10 em créditos comprados.
- O GitHub Models foi descontinuado em 30/07/2026 e não é opção.

## Escolha dos modelos (26/11/2026)

Uma chamada por modelo com o prompt real do RAG (P05, 3 trechos), conferindo a citação:

| Provedor | Modelo | Tempo | Resultado |
| --- | --- | --- | --- |
| Groq | `qwen/qwen3.8-27b` | 507 ms | citou a fonte, português correto |
| Groq | `openai/gpt-oss-120b` | 896 ms | citou a fonte, português correto |
| Groq | `openai/gpt-oss-20b` | 773 ms | repetiu a pergunta no início da resposta (fora da lista) |
| OpenRouter | `nvidia/nemotron-3.5-super-vl:free` | 7.786 ms | citou a fonte |
| OpenRouter | `nvidia/nemotron-3.5-lightning:free` | 7.860 ms | citou a fonte |
| OpenRouter | `google/gemma-4-31b-it:free`, `gemma-4-26b-a4b-it:free`, `baidu/ernie-5.5-flash-preview:free` | — | 429 do fornecedor do modelo gratuito (o 31b ficou por último: pode voltar) |

O `llama-3.1-8b-instant`, antiga reserva padrão da Groq, não existe mais na conta e foi
substituído pelo `qwen/qwen3.8-27b`.

## Verificação da cadeia com as chaves reais

| Cenário | Quem respondeu | Tempo total |
| --- | --- | --- |
| Todas as chaves | `gemini-3.5-flash-lite` (o 2.5 falhou antes) | 4,0 s |
| Sem `LLM_API_KEY` | `qwen/qwen3.8-27b` (Groq) | 1,7 s |
| Só `OPENROUTER_API_KEY` | `nvidia/nemotron-3.5-super-vl:free`, depois de falhas | 29,5 s |

Nos três cenários, o modelo que respondeu também chamou a ferramenta da recomendação
(`buscar_animais_disponiveis`). O OpenRouter é a última linha antes da contingência: lento,
mas sem custo.

## Conversa com ferramenta (recomendação), 26/11/2026

A recomendação é uma conversa em várias etapas: o modelo pede `buscar_animais_disponiveis`,
recebe o resultado e responde com o JSON. Ciclo completo testado em cada modelo:

| Modelo | Resultado |
| --- | --- |
| `gemini-2.5-flash` | completou (4,5 s) |
| `gemini-3.5-flash-lite`, `gemini-flash-lite-latest` | 400 na segunda etapa |
| `gemini-3.5-flash` | 503 / tempo esgotado |
| `openai/gpt-oss-120b` (Groq) | completou (1,7 s) |
| `qwen/qwen3.8-27b` (Groq) | pediu a ferramenta três vezes sem concluir; o agente força a conclusão na 4ª chamada |
| `nemotron-3.5-super-vl:free`, `nemotron-3.5-lightning:free` | completaram (~10 s) |

Os Gemini 3.x respondem à pergunta simples, mas pela API compatível com a OpenAI recusam a
segunda etapa da conversa com ferramenta, porque exigem de volta a assinatura de pensamento
que essa API não repassa. Com eles na lista, a recomendação gastava os 20 s do BFF passando
por modelos que não podiam concluir e caía no modo degradado. Por isso a lista padrão do
Gemini ficou só com modelos 2.x.
