# Demonstração ao vivo da Parte 4 — #74

Meta: 15 minutos de demonstração, com os quatro integrantes falando e terminais
prontos. Congelamento previsto: **09/12/2026 às 23h59, America/Sao_Paulo**.
Este documento é preparação: **os dois ensaios completos ainda não têm registro**.

Todos os cenários abaixo usam só o que já está na `develop`: o seed, os apps e
comandos `docker compose`. Os scripts automáticos de cenário previstos na #71
(`scripts/demo/reset.sh` e `01` a `05`) ainda não existem; quando chegarem,
podem substituir os passos manuais sem mudar a ordem da apresentação. Os
tempos citados foram medidos no Compose local em 25/11/2026.

## Preparação 30 minutos antes

1. Suba o sistema e popule os dados (o seed pode ser rodado de novo sem duplicar):

   ```bash
   docker compose up -d --build --wait
   ./scripts/seed.sh
   python3 scripts/demo/preflight.py      # PowerShell: py -3 scripts/demo/preflight.py
   ```

   O preflight confere arquivos, a busca pública e o 401 sem token. Ele não
   certifica o LLM nem as contas. Se o gateway estiver em outra porta (8080 no
   Codespace), passe a porta: `python3 scripts/demo/preflight.py 8080`.
2. Contas do seed, todas com a senha `SEED_SENHA_DEMO` do `.env` (nunca deste
   roteiro): `adotante@ampara.dev` (perfil completo), `ong@ampara.dev` (dona
   dos oito animais em Lavras), `protetor@ampara.dev` e `admin@ampara.dev`.
3. Um adotante só pode ter **uma solicitação ativa**. Se o ensaio deixou um
   pedido aberto, o próximo termina em `PERFIL_INVALIDO` (`LIMITE_SOLICITACOES`).
   Não há reset automático: cancele o pedido pelo App Mobile ou use uma conta nova.
4. Para os cenários de falha, crie antes duas contas de adotante pelo App Mobile
   (**Criar conta**, cidade Lavras): uma fica **sem** perfil de adoção e a outra
   recebe perfil completo. Assim o `adotante@ampara.dev` fica livre para o
   caminho feliz.
5. Confira Thor, Mel, Nina e Paçoca disponíveis na busca. Animais adotados em
   ensaio não voltam para a busca; use outro animal do seed ou recrie os volumes
   só no ambiente de demonstração.
6. O prazo de cada passo da SAGA é `ORQUESTRADOR_TIMEOUT_PASSO` (padrão `10s`) e
   a expiração da aprovação é `ORQUESTRADOR_PRAZO_EXPIRACAO` (padrão `72h`).
7. Abra o App Web (`npm run dev:web`), o App Mobile no telefone
   (`npm run dev:mobile -- --host`, IP da máquina na porta 5174), terminais de
   logs e o painel do RabbitMQ (`http://localhost:15672`). Aumente a fonte.
8. O Assistente só gera texto com `LLM_API_KEY` preenchida. Sem chave, ou com a
   cota do provedor esgotada, as perguntas voltam como "Resposta de contingência"
   (fontes da base, sem texto gerado). O Gemini gratuito permite 20 requisições
   por dia por modelo: não gaste a cota no ensaio da véspera.

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
| 1:00–3:00 | Gabriel Cantanhede | busca anônima no Mobile, ficha do Thor e comparação do JSON web/mobile | filtro por raio, card com foto e distância | curl pelo mesmo gateway ou navegador desktop em viewport de celular se o telefone perder a rede |
| 3:00–5:00 | Gabriel Cantanhede | cadastrar animal no Web e atualizar a busca no Mobile | nova escrita refletida na leitura, `atualizadoEm` e tempo medido | consultar `/mobile/v1/animais` pelo terminal sem bypass ao banco de leitura |
| 5:00–8:00 | Mateus | `adotante@ampara.dev` solicita o Thor no Mobile; `ong@ampara.dev` aprova no Web | `AGUARDANDO_APROVACAO` em cerca de 1 s, aprovação 202, `CONCLUIDA`, Thor `ADOTADO` e linha do tempo | mesmas chamadas pelo gateway (seção abaixo), acompanhando os estados |
| 8:00–10:00 | Mateus | `docker compose stop identidade`, pedido com a conta de perfil completo, logs do Orquestrador | `ANIMAL_RESERVADO`, timeout do passo, `LiberarReserva`/`LiberarVaga`, `FALHOU` em cerca de 12 s e animal de volta à busca; depois `docker compose start identidade` | conta sem perfil pede um animal: `PERFIL_INVALIDO` com motivo `PERFIL_INCOMPLETO` |
| 10:00–11:00 | Gabriel Soares | chamadas sem token e rate limit pelo gateway | 401 em rota privada e 429 numa demonstração separada | `./scripts/teste-rotas.sh`, com resultado real |
| 11:00–12:00 | Gabriel Soares | redes, bancos e configuração de cada serviço | cada serviço tem banco próprio e não alcança o banco dos outros (comando abaixo) | `docker compose config` mostrando as redes `data-*` de cada banco |
| 12:00–14:00 | Gabriel Nakazato | pergunta com fontes e recomendação de rotina | recuperação na base própria e tool consultando animais reais | POST pelo gateway, mantendo fontes e IDs reais |
| 14:00–15:00 | Gabriel Nakazato | falha controlada do provedor e `/v1/estado` | circuito abre após 3 falhas e a resposta seguinte vem do fallback sem chamar o provedor | mostrar o fallback real e registrar a indisponibilidade; vídeo curto somente como reserva |

Se o cluster estiver lento, interrompa chamadas paralelas, confirme pods prontos
e retome do último passo concluído. Não derrube serviços no meio de uma SAGA de
outro cenário nem troque silenciosamente de ambiente. Reserve um vídeo curto
local para falha da máquina; ele nunca substitui toda a execução ao vivo.

## Comandos de apoio pelo gateway

Busca pública e rota privada sem token:

```bash
curl --fail-with-body 'http://localhost:8000/mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10'
curl -i 'http://localhost:8000/mobile/v1/solicitacoes'
```

O segundo comando deve receber 401. Obtenha os tokens por `/auth/v1/sessoes` e
guarde-os em variáveis sem imprimir:

```bash
SENHA=$(grep '^SEED_SENHA_DEMO=' .env | cut -d= -f2-)
token() { curl -s -X POST http://localhost:8000/auth/v1/sessoes -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"senha\":\"$SENHA\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])'; }
TOKEN_ADOTANTE=$(token adotante@ampara.dev)
TOKEN_ONG=$(token ong@ampara.dev)
```

Caminho feliz sem os apps (`ANIMAL_ID` vem da busca):

```bash
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" --data "{\"animalId\":\"$ANIMAL_ID\"}" http://localhost:8000/mobile/v1/solicitacoes
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" "http://localhost:8000/mobile/v1/solicitacoes/$SOLICITACAO_ID"
curl --fail-with-body -X POST -H "Authorization: Bearer $TOKEN_ONG" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" --data '{}' "http://localhost:8000/web/v1/solicitacoes/$SOLICITACAO_ID/aprovacao"
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" "http://localhost:8000/mobile/v1/solicitacoes/$SOLICITACAO_ID/linha-do-tempo"
docker compose logs orquestrador animais identidade adocao | grep -F "$SOLICITACAO_ID"
```

No cenário da Identidade fora, obtenha o token **antes** do `stop` (o login
depende dela) e religue com `docker compose start identidade` mesmo que algo
falhe no meio. Acompanhe pelos logs até `ReservaLiberada` e `FALHOU`; não
encerre a observação logo após publicar `LiberarVaga`.

Isolamento dos bancos: cada banco está numa rede só com o serviço dono.

```bash
docker compose exec -T identidade node -e "require('dns').lookup('mongo-animais', e => console.log(e ? 'sem acesso: ' + e.code : 'acessível'))"
docker compose exec -T animais python -c "import socket; socket.gethostbyname('postgres-identidade')"   # falha com gaierror
```

## Assistente, cache e pergunta nova

O dono do Assistente confere ingestão e tool antes do ensaio. Perguntas sugeridas
para aquecer o cache: “Como preparar a casa para receber um cão adotado?” e
“Como apresentar um gato adotado aos animais que já tenho?”. Confira as fontes
retornadas; não trate a resposta de contingência como resposta RAG válida.

```bash
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" -H 'Content-Type: application/json' --data '{"pergunta":"Como preparar a casa para receber um cão adotado?"}' http://localhost:8000/mobile/v1/assistente/perguntas
curl --fail-with-body -H "Authorization: Bearer $TOKEN_ADOTANTE" -H 'Content-Type: application/json' --data '{"descricaoRotina":"Moro em apartamento, fico seis horas fora e posso passear de manhã e à noite.","lat":-21.2468,"lng":-44.9998,"raioKm":10}' http://localhost:8000/mobile/v1/assistente/recomendacoes
```

O BFF Mobile projeta as respostas do Assistente no contrato mobile (#210):
`descricaoRotina` vira `rotina`, `sugestoes[].motivo` vira
`animais[].motivoRecomendacao` e a origem das fontes vira `paginaOuSecao`. A
recomendação exige `lat`/`lng`: o comando acima usa Lavras; no app, vale a
localização e o raio da última busca. Nunca extrair coordenadas da rotina nem
pedir ao LLM que as escolha.

Na apresentação, repita uma pergunta aquecida e faça outra inédita, por exemplo:
“Como adaptar a rotina de passeios de um cão idoso recém-adotado?”. Compare a
recomendação com os IDs e status atuais da busca. A análise com e sem RAG,
latência e custo está em [`docs/llm/avaliacao-rag.md`](../../llm/avaliacao-rag.md).

Fala: "Na pergunta, a chain recupera até quatro trechos versionados antes de
gerar. As fontes precisam corresponder a esses trechos. Na recomendação, a
tool consulta a busca real; só pode sugerir IDs disponíveis que ela retornou.
O servidor aplica a localização sem enviá-la ao provedor. A busca e a SAGA
continuam funcionando quando a geração falha."

O contrato do BFF não expõe cache nem latência: uma resposta rápida pelo app não
prova cache. Consulte a API interna a partir do próprio container, sem publicar
nova porta. Token em variável local, sem `set -x` ou impressão do ambiente:

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
    with urlopen(req, timeout=40) as resposta:
        dado = json.load(resposta)
    print({campo: dado[campo] for campo in ('cache', 'latenciaMs', 'degradado')})
req = Request('http://localhost:8003/v1/estado', headers=headers)
with urlopen(req, timeout=5) as resposta:
    print(json.load(resposta))
PY
```

Só respostas geradas pelo LLM entram no cache: em contingência, `cache` fica
`false`. Se o cache já estiver quente, ambas podem ser hits: use a pergunta
inédita para mostrar miss. O `/v1/estado` é interno e por réplica; no cluster,
consulte sempre o mesmo pod.

Falha controlada: suba só o Assistente com uma chave inválida, sem editar o `.env`,
faça quatro perguntas diferentes pelo snippet acima e mostre o `/v1/estado`.

```bash
LLM_PROVIDER=openai LLM_API_KEY=chave-invalida-demo docker compose up -d --wait assistente
# ... quatro perguntas ...
docker compose up -d --wait assistente   # volta à configuração do .env
```

No ensaio de 25/11, as três primeiras falharam no provedor (cerca de 1 s cada,
`degradado: true`), o circuito abriu (`"circuito": "aberto"`,
`falhasConsecutivas: 3`) e a quarta veio do fallback em 10 ms, sem chamar o
provedor. Depois de 30 s o circuito passa a meio-aberto e testa uma chamada;
com a chave certa, ele fecha de novo. Recriar o container zera os contadores.

## Perguntas de arguição (todos estudam)

| Pergunta | Quem inicia a preparação | Referência |
| --- | --- | --- |
| Por que a SAGA é orquestrada e quem guarda seu estado? | Mateus | [SAGA](../../saga.md), [ADR-008](../../decisoes/ADR-008-orquestrador.md) |
| Como se retoma após queda do Orquestrador? | Mateus | [Dados, outbox/inbox](../../dados.md) |
| O que acontece se a compensação chega antes da reserva? | Gabriel Cantanhede | [Defesa nos participantes](../../saga.md#7-defesa-nos-participantes) |
| Dois adotantes podem reservar o mesmo animal? | Gabriel Cantanhede | atualização condicional descrita em [SAGA](../../saga.md) |
| Qual é o pivô e por que não desfazer depois dele? | Mateus | [Passos](../../saga.md#2-passos) |
| Outbox oferece exactly once? O que faz a inbox? | todos | [Dados](../../dados.md) |
| Como medir atraso e reconstruir o read model? | Gabriel Cantanhede | [CQRS](../../cqrs.md) |
| Por que assinatura, role e dono são verificados em camadas? | Gabriel Soares | [Gateway](../../gateway.md) |
| O que é dado durável em Notificações? | Gabriel Nakazato | [Dados](../../dados.md), README do serviço |
| O que prova que houve RAG e chamada de tool? | Gabriel Nakazato | [LLM](../../llm/README.md), [avaliação](../../llm/avaliacao-rag.md) |
| Como o circuito abre, testa recuperação e fecha? | Gabriel Nakazato | `services/assistente/app/resiliencia.py` e a falha controlada acima |

Os nomes acima indicam quem prepara a explicação, não exclusividade: no ensaio,
sorteie um colega diferente para responder e peça que cite o arquivo pertinente.

## Dois ensaios completos

Cada ensaio começa com o sistema recém-subido, `./scripts/seed.sh`, as contas
de teste criadas e nenhuma solicitação ativa; usa a ordem integral e mede do
primeiro ao último passo. Anote travadas e corrija código/script; não registre
apenas uma fala improvisada como solução. Repita após correções.

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
| RL-03 avaliação com/sem recuperação | apoio de `docs/llm/avaliacao-rag.md` | perguntas e análise registradas |
| RL-04 LangChain e tool | 12:00–14:00 | tool consultando animais reais |
| RL-05 agente opcional | fala do dono | se houver, justificar decisão dinâmica; se não, registrar escolha |
| RL-06 resiliência | 14:00–15:00 | falha provocada, circuito/timeout/cache/fallback observados |
| RL-07 latência e custo | 14:00–15:00 e avaliação | medições e cálculo com parâmetros registrados |
| E-7.1 participação individual | toda a demo | quatro falas substantivas e arguição cruzada |

- [ ] Dois ensaios reais registrados, com correções verificáveis.
- [ ] Cache aquecido e pergunta inédita testada (exige `LLM_API_KEY` com cota).
- [ ] Planos B de LLM, navegador mobile e cluster exercitados.
- [ ] Quatro integrantes revisaram seus trechos e os de outro colega.
- [ ] Dependências e documentação de avaliação integradas antes do congelamento.
