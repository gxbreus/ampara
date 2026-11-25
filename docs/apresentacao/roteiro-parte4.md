# Demonstração ao vivo da Parte 4 — #74

Meta: 15 minutos de demonstração, com os quatro integrantes falando e terminais
prontos. Congelamento previsto: **09/12/2026 às 23h59, America/Sao_Paulo**.
Este documento é preparação: **os dois ensaios completos ainda não têm registro**.

## Preparação 30 minutos antes

1. Use um checkout integrado, com #43, #53–#65, #67–#71 e #73 disponíveis.
   Os nomes dos cenários abaixo vêm da #71; se os arquivos ainda não existirem,
   a demonstração está bloqueada. Não substitua participantes reais por
   `participantes_falsos.py` na evidência de funcionamento distribuído.
2. Rode `python3 scripts/demo/preflight.py` (PowerShell: `py -3 scripts/demo/preflight.py`). Ele verifica arquivos e rotas básicas;
   não certifica dados do seed, funcionamento do LLM ou autorização completa.
3. Em ambiente dedicado de demo, rode `bash scripts/demo/reset.sh`. Ele é
   destrutivo para os dados de demonstração conforme a #71; não use banco real.
4. Confira Bruna com perfil completo, Caio sem aceite e ONG Patas de Lavras
   verificada; confira Thor, Mel, Pipoca e Nina disponíveis. As senhas vêm da
   configuração local de seed, nunca deste roteiro.
5. Abra App Web, App Mobile no telefone, terminais do gateway/serviços, RabbitMQ
   e Qdrant. Aumente a fonte. Confirme que o telefone usa o IP da máquina.
6. Use `ORQUESTRADOR_TIMEOUT_PASSO` e `ORQUESTRADOR_PRAZO_EXPIRACAO` para os
   prazos atuais da SAGA; os nomes antigos `ADOCAO_*` da #71 foram substituídos
   na extração da ADR-008. Ensaie o prazo antes de usá-lo ao vivo.

No Compose:

```bash
docker compose ps
docker compose logs --tail=30 orquestrador animais identidade adocao
```

No cluster, em sessão separada da porta 8000 do Compose:

```bash
kubectl get pods -n ampara -o wide
kubectl get deploy,svc,ingress -n ampara
```

## Ordem e plano B

| Tempo | Quem | Execução/tela | Resultado que precisa aparecer | Plano B |
| --- | --- | --- | --- | --- |
| 0:00–1:00 | Mateus | diagrama e `kubectl get pods` | gateway, dois BFFs, serviços e Orquestrador separados | diagrama local e `docker compose ps`, identificando qual ambiente está em uso |
| 1:00–3:00 | Gabriel Cantanhede | busca anônima no Mobile, Thor e comparação do JSON web/mobile | filtro por raio, oito campos do card, foto e distância | curl pelo mesmo gateway ou navegador desktop em viewport de celular se o telefone perder a rede |
| 3:00–5:00 | Gabriel Cantanhede | cadastrar animal no Web e atualizar busca Mobile | nova escrita refletida na leitura, `atualizadoEm` e tempo medido | consultar `/mobile/v1/animais` pelo terminal sem bypass ao banco de leitura |
| 5:00–8:00 | Mateus | `bash scripts/demo/01-caminho-feliz.sh`, Web e Mobile | Bruna solicita Thor, ONG aprova, linha do tempo, ADOTADO e aviso | script com APIs reais, acompanhando estados pelo gateway |
| 8:00–10:00 | Mateus | `bash scripts/demo/04-identidade-fora.sh` e logs | timeout, compensação, ReservaLiberada, FALHOU e Nina de volta à busca; ao religar Identidade, vaga liberada | `bash scripts/demo/02-perfil-incompleto.sh`, Caio/Mel e PERFIL_INVALIDO |
| 10:00–11:00 | Gabriel Soares | chamadas sem token e rate limit pelo gateway | 401 em rota privada e 429 numa demonstração separada | testes de rotas via terminal, com resultado real |
| 11:00–12:00 | Gabriel Soares | redes, bancos e configuração de cada serviço | cada serviço tem banco próprio; demonstrar tentativa negada de acesso cruzado | procedimento de isolamento do dono, já ensaiado; não usar só diagrama como prova |
| 12:00–14:00 | Gabriel Nakazato | pergunta com fontes e recomendação de rotina | recuperação na base própria e tool consultando animais reais | POST pelo gateway, mantendo fontes e IDs reais |
| 14:00–15:00 | Gabriel Nakazato | falha controlada do provedor e observabilidade | circuito/fallback e métricas de latência/custo medidas | mostrar fallback real e registrar indisponibilidade; vídeo curto somente como reserva |

Se o cluster estiver lento, interrompa chamadas paralelas, confirme pods prontos
e retome do último passo concluído. Não faça reset no meio de uma SAGA nem
troque silenciosamente de ambiente. Reserve um vídeo curto local para falha da
máquina; ele nunca substitui toda a execução ao vivo.

## Comandos de apoio pelo gateway

Busca pública:

```bash
curl --fail-with-body 'http://localhost:8000/mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10'
curl -i 'http://localhost:8000/mobile/v1/solicitacoes'
```

O segundo comando deve receber 401 sem token. Use tokens de adotante/ONG
obtidos por `/auth/v1/sessoes` e guarde-os em variáveis locais sem imprimir.
O material anterior que diz `/api/v1/auth` usa o prefixo antigo.

Para acompanhar uma solicitação real, defina `SOLICITACAO_ID` e `TOKEN_ADOTANTE`:

```bash
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" "http://localhost:8000/mobile/v1/solicitacoes/$SOLICITACAO_ID"
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" "http://localhost:8000/mobile/v1/solicitacoes/$SOLICITACAO_ID/linha-do-tempo"
docker compose logs orquestrador animais identidade adocao | grep -F "$SOLICITACAO_ID"
```

O cenário 04 deve restaurar a Identidade mesmo se falhar e aguardar a liberação
da vaga da Bruna antes do próximo pedido. Confira isso no script da #71 antes
do ensaio; não encerre a observação logo após publicar `LiberarVaga`.

## Assistente, cache e pergunta nova

O dono do Assistente confere ingestão e tool antes do ensaio. Perguntas sugeridas
para aquecer o cache: “Como preparar a casa para receber um cão adotado?” e
“Como apresentar um gato adotado aos animais que já tenho?”. Confira as fontes
retornadas; não trate o fallback como resposta RAG válida.

```bash
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" -H 'Content-Type: application/json' --data '{"pergunta":"Como preparar a casa para receber um cão adotado?"}' http://localhost:8000/mobile/v1/assistente/perguntas
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" -H 'Content-Type: application/json' --data '{"descricaoRotina":"Moro em apartamento, fico seis horas fora e posso passear de manhã e à noite."}' http://localhost:8000/mobile/v1/assistente/recomendacoes
```

Na apresentação, repita uma pergunta aquecida e faça outra inédita, por exemplo:
“Como adaptar a rotina de passeios de um cão idoso recém-adotado?”. Registre as
latências reais e a indicação de cache conforme a implementação #69; não
conclua “veio do cache” apenas porque pareceu rápido. Compare recomendação com
os IDs/status atuais da busca. A análise com/sem RAG e custo depende da #70.

### Conferência do trecho do Gabriel — 2026-11-17

O roteiro ainda depende das implementações #66–#70. O contrato mobile usa
`descricaoRotina` e `animais[].motivoRecomendacao`, enquanto a #24 define
`rotina` e `sugestoes[].motivo`. A #62 deve adaptar esses campos e a origem das
fontes. O corpo mobile acima ainda não fornece localização: não considerar a
recomendação demonstrável antes de #62/#65 levarem lat/lng/raioKm do contexto
de busca ao servidor. Nunca extrair coordenadas da rotina nem pedir ao LLM que
as escolha. Atualizar o comando externo conforme o contrato integrado no ensaio.

Fala: "Na pergunta, a chain recupera até quatro trechos versionados antes de
gerar. As fontes precisam corresponder a esses trechos. Na recomendação, a
tool consulta a busca real; só pode sugerir IDs disponíveis que ela retornou.
O servidor aplica a localização sem enviá-la ao provedor. A busca e a SAGA
continuam funcionando quando a geração falha."

O contrato do BFF não expõe cache/latência: uma resposta rápida pelo app não
prova cache. Para a demonstração operacional, depois da #69, consulte a API
interna a partir do próprio container, sem publicar nova porta. Token em
variável local, sem `set -x` ou impressão do ambiente:

```bash
docker compose exec -T -e TOKEN_DEMO="$TOKEN_ADOTANTE" assistente python - <<'PY'
import json
import os
from urllib.request import Request, urlopen

headers = {'Authorization': 'Bearer ' + os.environ['TOKEN_DEMO'],
           'Content-Type': 'application/json'}
for _ in range(2):
    corpo = json.dumps({'pergunta': 'Como preparar a casa para receber um cão adotado?'}).encode()
    req = Request('http://localhost:8003/v1/perguntas', data=corpo, headers=headers)
    with urlopen(req, timeout=18) as resposta:
        dado = json.load(resposta)
    print({campo: dado[campo] for campo in ('cache', 'latenciaMs', 'degradado')})
req = Request('http://localhost:8003/v1/estado', headers=headers)
with urlopen(req, timeout=3) as resposta:
    print(json.load(resposta))
PY
```

Se o cache já estiver quente, ambas podem ser hits: use a pergunta inédita para
mostrar miss. Não apague o Redis de Notificações para alterar cache de geração.
O `/v1/estado` é interno e por réplica; ao comparar contadores no cluster,
consulte o mesmo pod. Não anuncie estado global a partir de uma única resposta.

Para a falha controlada, use provedor falso e configuração de demonstração
entregues pela #69; não suponha que trocar uma chave abre imediatamente o
circuito, nem que reiniciar o processo preserva seus contadores. O runbook
deve conter o comando que passou no ensaio. Mostre falhas, abertura, fallback,
prova em meio-aberto e recuperação; se não houver evidência, mantenha a lacuna
registrada. Latência/custo são os dados medidos da #70, sem preencher números
estimados como resultados. Nenhum ensaio ou chamada acima foi executado neste
registro: faltam seed/reset da #71 e integração dos serviços.

## Perguntas de arguição (todos estudam)

| Pergunta | Quem inicia a preparação | Referência |
| --- | --- | --- |
| Por que a SAGA é orquestrada e quem guarda seu estado? | Mateus | [SAGA](../saga.md), [ADR-008](../decisoes/ADR-008-orquestrador.md) |
| Como se retoma após queda do Orquestrador? | Mateus | [Dados, outbox/inbox](../dados.md) |
| O que acontece se a compensação chega antes da reserva? | Gabriel Cantanhede | [Defesa nos participantes](../saga.md#7-defesa-nos-participantes) |
| Dois adotantes podem reservar o mesmo animal? | Gabriel Cantanhede | atualização condicional descrita em [SAGA](../saga.md) |
| Qual é o pivô e por que não desfazer depois dele? | Mateus | [Passos](../saga.md#2-passos) |
| Outbox oferece exactly once? O que faz a inbox? | todos | [Dados](../dados.md) |
| Como medir atraso e reconstruir o read model? | Gabriel Cantanhede | [CQRS](../cqrs.md) |
| Por que assinatura, role e dono são verificados em camadas? | Gabriel Soares | [Gateway](../gateway.md) |
| O que é dado durável em Notificações? | Gabriel Nakazato | [Dados](../dados.md), README do serviço |
| O que prova que houve RAG e chamada de tool? | Gabriel Nakazato | [LLM](../llm/README.md), avaliação da #70 |
| Como o circuito abre, testa recuperação e fecha? | Gabriel Nakazato | implementação e evidências da #69 |

Os nomes acima indicam quem prepara a explicação, não exclusividade: no ensaio,
sorteie um colega diferente para responder e peça que cite o arquivo pertinente.

## Dois ensaios completos

Cada ensaio começa com `bash scripts/demo/reset.sh`, usa a ordem integral e
mede do primeiro ao último passo. Anote travadas e corrija código/script; não
registre apenas uma fala improvisada como solução. Repita após correções.

| Ensaio | Data/hora e fuso | Commit | Participantes | Tempo total | O que falhou | Correção/PR | Evidência |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | pendente | pendente | pendente | pendente | pendente | pendente | pendente |
| 2 | pendente | pendente | pendente | pendente | pendente | pendente | pendente |

## Cobertura da avaliação

| Requisito | Trecho | Evidência necessária |
| --- | --- | --- |
| RF-01 ponta a ponta | 1:00–8:00 | app → gateway → BFF → serviços reais |
| RF-02 SAGA feliz e compensação | 5:00–10:00 | estados, comandos/respostas e reserva liberada |
| RF-03 CQRS | 3:00–5:00 | escrita e leitura posterior, tempo medido |
| RF-04 bancos separados | 11:00–12:00 | bancos próprios e tentativa de acesso cruzado negada |
| RL-01 propósito no domínio | 12:00–14:00 | orientação de adoção responsável |
| RL-02 RAG | 12:00–14:00 | recuperação na base própria e fontes |
| RL-03 avaliação com/sem recuperação | apoio da #70 | cinco perguntas e análise, documento existente no dia |
| RL-04 LangChain e tool | 12:00–14:00 | tool consultando animais reais |
| RL-05 agente opcional | fala do dono | se houver, justificar decisão dinâmica; se não, registrar escolha |
| RL-06 resiliência | 14:00–15:00 | falha provocada, circuito/timeout/cache/fallback observados |
| RL-07 latência e custo | 14:00–15:00 e #70 | medições e cálculo com parâmetros registrados |
| E-7.1 participação individual | toda a demo | quatro falas substantivas e arguição cruzada |

- [ ] Dois ensaios reais registrados, com correções verificáveis.
- [ ] Cache aquecido e pergunta inédita testada.
- [ ] Planos B de LLM, navegador mobile e cluster exercitados.
- [ ] Quatro integrantes revisaram seus trechos e os de outro colega.
- [ ] Dependências e documentação de avaliação integradas antes do congelamento.
