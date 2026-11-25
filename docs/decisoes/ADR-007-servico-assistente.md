# ADR 007: Serviço Assistente para o LLM

- Status: decisão arquitetural aceita no kickoff #19; implementação nas #42 e #66–#70
- Data do registro: 2026-11-17
- Origem: [decisões do kickoff, 2026-10-07](../requisitos.md#decisões-do-kickoff-2026-10-07-19)

## Contexto

HU-18 exige respostas sobre adoção responsável fundamentadas em fontes; HU-19
exige recomendações com animais disponíveis reais. Geração tem latência variável,
custo por token e dependência de rede e cotas externas. Busca, cadastro e SAGA
precisam continuar funcionando quando o provedor falhar. Esses fluxos não devem
disputar o mesmo orçamento de tempo, conexões e recursos do LLM.

O kickoff #19 ratificou FastAPI + LangChain, Qdrant, Redis dedicado, Groq no
free tier, Ollama como fallback e embeddings locais multilíngues. Esta ADR
registra essas escolhas; não declara testes, medições ou revisões já realizados.

## Decisão

### Limite do serviço e contratos

Criar `assistente`, porta interna 8003, com escala, limites de recursos e ciclo
de implantação próprios. Ele não participa das transações da SAGA. Uma queda
degrada apenas a experiência de assistência; os BFFs mantêm os demais fluxos.

O [contrato da #24](https://github.com/gxbreus/ampara/issues/24) define
`POST /v1/perguntas`, `POST /v1/recomendacoes` e `GET /v1/estado`.
Perguntas seguem uma chain fixa: recuperar até quatro trechos e gerar com
referências. Sem cobertura, orientar sem inventar fontes. Recomendações usam
um agente limitado a três iterações, cuja tool consulta a API de busca de
Animais; não lê seu MongoDB e só recomenda IDs retornados com status DISPONIVEL.

Os BFFs adaptam esses contratos para cada app. Na integração mobile (#62/#65),
é necessário mapear os nomes dos campos e fornecer a localização separadamente
do texto da rotina; o contrato mobile atual ainda não declara essa entrada.

### Dados e recuperação

`qdrant-assistente` é a base vetorial própria, com volume persistente. A ingestão
roda separadamente da API (#66), preserva autoria, URL, data, versão da base e
IDs determinísticos. Embeddings são locais via Ollama, modelo `bge-m3`, conforme
`EMBEDDINGS_PROVIDER` e `EMBEDDINGS_MODEL`. Sua descrição oficial informa suporte
multilíngue; a qualidade de recuperação em português será avaliada na #70, não
é uma medição desta ADR ([modelo no Ollama](https://ollama.com/library/bge-m3),
consulta em 2026-11-17).

`redis-assistente` guarda somente cache descartável, sem volume nem AOF, com
`allkeys-lru`, senha e rede própria. Não compartilha instância com Notificações,
cuja caixa requer persistência e não pode sofrer expulsão por pressão do cache.
O texto da issue #35 sugeria 64 MB; o `compose.yaml` já usa **96 MB** de maxmemory,
com limite de container de 128 MB. Esta ADR registra o estado executável atual,
sem alterar silenciosamente a infraestrutura. Ajustes futuros devem manter
maxmemory abaixo do limite do container e medir a folga necessária.

### Provedor, orçamento e resiliência

Usar Groq com `LLM_PROVIDER=groq`, modelo inicial `openai/gpt-oss-120b` via
`LLM_MODEL`, com suporte a tool calling. É a concretização do exemplo votado
no kickoff, não uma nova deliberação da equipe. A escolha prioriza orçamento
zero no free tier e geração remota rápida; latência e qualidade em português
dependem da avaliação #70. Chave ausente não impede o serviço de subir.

Ollama local é o provedor secundário configurável por `LLM_FALLBACK_MODEL`.
O kickoff não fixou seu modelo de geração: ele deve ser escolhido e registrado
conforme a memória da máquina da demo. Não confundir `bge-m3` (embeddings) com
um modelo gerador. Sem modelo local instalado ou dentro do prazo, responder
com os trechos recuperados; sem trechos, emitir orientação estática explícita.

Implementar na [#69](https://github.com/gxbreus/ampara/issues/69): timeout de
15 s como orçamento total, retries seletivos para 429/5xx com backoff e jitter
(até três tentativas dentro desse orçamento), circuit breaker (cinco falhas
em 30 s; prova após 60 s), cache e fallback. O orçamento total fica abaixo dos
20 s de timeout do BFF Mobile. Erros de autenticação ou entrada não recebem
retry. Cache inclui pergunta normalizada, versão da base e modelo; não deve
misturar respostas de versões distintas. Falha de cache permite continuar.

`/v1/estado` informa circuito fechado, aberto ou meio-aberto e contadores por
réplica, sem segredos. Resposta degradada usa HTTP 200 e `degradado=true`; 503
só quando também não houver fallback. `/ready` verifica Qdrant e Redis,
nunca chama o LLM; chave vazia ou circuito aberto não significam falta de
prontidão. Logs JSON carregam correlationId, sem texto livre ou credenciais.

### Privacidade

O servidor recebe lat, lng e raioKm em campos próprios e os injeta diretamente
na busca. O LLM não recebe nem escolhe coordenadas ou raio. Antes da geração,
remover coordenadas e distância exata dos resultados; usar apenas dados
públicos necessários dos animais. Não enviar cadastro, CPF, e-mail, endereço,
token JWT ou perfil identificável ao provedor. O pré-preenchimento mobile deve
conter apenas características da rotina, sem dados pessoais.

Texto livre pode conter dados pessoais digitados pelo usuário: campos separados
e instrução na tela não garantem anonimização. A integração deve validar e
redigir dados identificáveis antes de qualquer envio remoto; se não puder
garantir o tratamento, deve usar resposta local. Não persistir prompts brutos
em logs. Cache usa hash na chave, mas a resposta também requer minimização e
TTL; hash sozinho não anonimiza o conteúdo armazenado.

### Estimativa inicial de custo

Consulta em **2026-11-17**, sem chamada paga. A página oficial do modelo informa
US$ 0,15 por milhão de tokens de entrada e US$ 0,60 por milhão de saída
([Groq, GPT-OSS 120B](https://console.groq.com/docs/model/openai/gpt-oss-120b)).
A página genérica `/pricing` redirecionou à home; a fonte dos valores é a página
específica do modelo. As cotas do free tier são por organização e precisam ser
conferidas na conta da demo ([limites oficiais](https://console.groq.com/docs/rate-limits)).

Hipótese por pergunta sem cache: 2000 tokens de entrada (instruções, pergunta
e quatro trechos) e 400 de saída, incluindo tokens de geração cobrados.

```text
custo = (2000 × 0,15 + 400 × 0,60) / 1.000.000
      = US$ 0,00054 por pergunta
1000 / 10.000 / 100.000 perguntas = US$ 0,54 / 5,40 / 54,00
```

É projeção na tarifa paga, não fatura ou medição. No free tier, o objetivo é
desembolso de API zero dentro das cotas; excedê-las não autoriza cobrança ou
upgrade automático. Com taxa de acerto de cache h, a parcela variável estimada
é `(1-h) × N × 0,00054`, desconsiderando retries e múltiplas chamadas do agente.
Embeddings e fallback locais consomem RAM, CPU e energia: não têm tarifa de API,
mas seu custo operacional não foi medido. A #70 substituirá as hipóteses por
tokens reais, p50/p95, efeito do cache e avaliação humana de dois avaliadores.

## Alternativas consideradas

| Alternativa | Motivo para não adotar no MVP |
| --- | --- |
| LLM dentro de Animais | Mistura busca de baixa latência com geração lenta, falhas externas e escala distinta; aumenta o impacto sobre a SAGA. |
| LLM chamado diretamente pelos BFFs | Duplica credenciais, recuperação, cache e resiliência entre web e mobile; dificulta medir e evoluir a mesma política. |
| pgvector | Requer PostgreSQL próprio e operação de sua extensão, ou compartilhar banco de outro domínio; não reutilizar o PostgreSQL da SAGA só para reduzir containers. |
| Chroma | Alternativa válida para base pequena; Qdrant já foi escolhido no kickoff e tem serviço e volume previstos no Compose. Trocar agora exige revalidar ingestão, recuperação e operação sem ganho demonstrado para o trabalho. |
| Cache no Redis de Notificações | Une dados persistentes a cache expulsável, credenciais e pressão de memória; compromete isolamento e previsibilidade da caixa. |
| Somente Ollama | Evita envio remoto, mas concentra inferência e memória na máquina da demo; manter como opção local e fallback, sem presumir desempenho. |
| Somente Groq | Depende de rede e cotas; não oferece continuidade quando o provedor falha. |

## Consequências

- Mais um serviço, uma base vetorial e um cache para construir, observar e operar.
- Escala e falhas independentes; não existe atomicidade entre respostas do LLM
  e mudanças posteriores de disponibilidade dos animais. Adoção revalida a reserva.
- A base precisa de versão e ingestão reproduzível; alterar embeddings requer
  reindexação e invalidação do cache, não mistura de vetores incompatíveis.
- Free tier não é SLA nem orçamento ilimitado. Sem rede, modelo local ou memória,
  a demo deve continuar com fallback explícito e fontes reais quando disponíveis.
- #66–#70 e a integração mobile continuam responsáveis por evidências de execução;
  esta decisão não comprova sua implementação ou a qualidade das respostas.
