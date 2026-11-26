# Cache semântico de respostas do Assistente

O Assistente já tinha cache exato no Redis (#69): mesma pergunta, mesma versão da base e
mesmo modelo devolvem a resposta salva por 24 h. Ele só acerta perguntas idênticas;
"Encontrei um cão abandonado, o que fazer?" e "Achei um cachorro abandonado, o que eu
faço?" geravam duas chamadas ao LLM.

O cache semântico (`services/assistente/app/cache_semantico.py`) guarda no Qdrant o
embedding de cada pergunta respondida (o mesmo vetor já calculado para a busca, sem custo
extra) e reaproveita a resposta de uma pergunta equivalente.

## Fluxo de `POST /v1/perguntas`

1. embedding da pergunta e busca dos trechos (uma vez só);
2. nada relevante: recusa fora do domínio, sem LLM;
3. cache exato (Redis), agora sem caixa, pontuação nem espaços extras;
4. cache semântico (Qdrant, coleção `ampara_cache_respostas`);
5. LLM; a resposta aceita vai para os dois caches.

Falha do Qdrant ou do Redis no cache nunca derruba a resposta: vira "não achei".

## Por que a similaridade sozinha não basta

Medição de 2026-11-26 com o modelo de embeddings da base
(`paraphrase-multilingual-MiniLM-L12-v2`, cosseno):

| Par | Similaridade | Mesma resposta? |
| --- | --- | --- |
| "quais vacinas o filhote precisa" × "Quais vacinas o filhote precisa?" | 0,986 | sim |
| "Quais cuidados devo tomar com a vacinação de um filhote de cão adotado?" × "Que cuidados tomar ao vacinar um filhote de cachorro adotado?" | 0,984 | sim |
| "O que a Lei 14.064 de 2020 mudou?" × "O que mudou com a Lei 14.064/2020?" | 0,972 | sim |
| "Encontrei um cão abandonado, o que fazer?" × "Achei um cachorro abandonado, o que eu faço?" | 0,971 | sim |
| "Quais vacinas um filhote de cão precisa?" × "Que vacinas meu filhote de cachorro precisa tomar?" | 0,963 | sim |
| **"Quais vacinas um filhote de cão precisa?" × "Quais vacinas um cão adulto precisa?"** | **0,956** | **não** |
| "Como deixar janelas e varandas seguras antes de adotar um gato?" × "Como proteger janelas e sacadas antes de adotar um gato?" | 0,951 | sim |
| "Meu gato pode sair na rua?" × "Meu gato não pode sair na rua?" | 0,934 | não |
| "Posso adotar um cão de porte grande morando em apartamento?" × "… porte pequeno …" | 0,925 | não |
| "Receber o aceite significa que a adoção foi concluída?" × "O aceite da solicitação já conclui a adoção?" | 0,881 | sim |
| "Receber o aceite…" × "Receber a recusa significa que a adoção foi cancelada?" | 0,861 | não |
| "Quais vacinas um filhote de cão precisa?" × "… filhote de gato …" | 0,832 | não |
| "Como apresentar o animal adotado aos outros animais da casa?" × "Como apresentar meu novo pet aos animais que já tenho?" | 0,780 | sim |

As faixas se sobrepõem: "filhote × adulto" (0,956) fica acima de duas paráfrases. Um
limiar de 0,95 devolveria a resposta do filhote para quem perguntou do adulto. Por isso o
acerto exige, além da mesma versão da base e do mesmo modelo:

1. **similaridade ≥ 0,97** (`CACHE_SEMANTICO_LIMIAR`; 0 desliga);
2. **o mesmo trecho mais relevante**, e **todas as fontes citadas na resposta salva entre os
   trechos recuperados agora**. Os trechos do fim da lista, perto do limiar de relevância,
   entram e saem entre paráfrases (o `09-errata-mpdft.md` aparece em "Encontrei um cão…" e
   some em "Achei um cachorro…"); exigir a lista inteira igual zerava os acertos;
3. **os mesmos números na pergunta** (lei, idade, quantidade), sem separador de milhar.

O custo do limiar alto é perder paráfrases mais soltas (0,95 e abaixo continuam indo ao
LLM). É a troca certa: errar para o lado da chamada a mais custa frações de centavo;
errar para o outro lado entrega a resposta de outra pergunta.

## Verificação no sistema rodando (2026-11-26)

Qdrant e Gemini reais, cache exato desligado para isolar o semântico:

| Pergunta | Cache | Latência |
| --- | --- | --- |
| Encontrei um cão abandonado, o que fazer? | não | 6.109 ms |
| Achei um cachorro abandonado, o que eu faço? | **semântico** | **15 ms** |
| Encontrei um gato abandonado, o que fazer? | não (outra pergunta) | 4.479 ms |
| O que a Lei 14.064 de 2020 mudou? | não | 1.361 ms |
| O que mudou com a Lei 14.064/2020? | **semântico** | **55 ms** |
| O que a Lei 9.605 de 1998 diz? | não (outros números) | 2.781 ms |

As latências sem cache incluem novas tentativas: a cota gratuita do modelo principal tinha
acabado e o modelo de reserva respondeu.

## Observação

`GET /v1/estado` mostra `cacheHits` (exato e semântico) e `cacheSemanticoHits` (só o
semântico). As respostas vencem junto com o cache exato (`cache_ttl_s`, 24 h); a limpeza
das vencidas acontece a cada gravação.
