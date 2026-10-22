# Requisitos — Ampara

Cliente: disciplina de Sistemas Distribuídos (2º sem. 2026) · Data: 2026-10-06 · Versão: 0.1 (rascunho para validação do grupo)

> Itens marcados *(a confirmar)* são premissas ou decisões que o grupo ainda precisa validar. Cada requisito aponta para o item do enunciado de onde ele vem (ex.: `E-4.6` = seção 4.6 do enunciado).

## 1. Resumo do problema (espelho da descoberta)

Avistamentos, resgates e anúncios de adoção circulam de forma fragmentada em grupos de WhatsApp e redes sociais. A Ampara junta **protetores e ONGs** (App Web) e **adotantes** (App Mobile) em um fluxo único: o animal é cadastrado, encontrado por localização e adotado por um processo transparente, com avisos a cada etapa.

Pelo enunciado, o problema também é **técnico e acadêmico**: o domínio precisa sustentar e demonstrar, **em código funcional**, microsserviços, API REST com HATEOAS, gateway, BFF, database per service, outbox, SAGA, CQRS, Docker/Kubernetes e LLM com RAG, LangChain e resiliência.

**Sucesso significa:**
- cumprir 100% dos itens avaliados das Partes 2, 3 e 4;
- permitir que um terceiro suba o sistema do zero seguindo o README (`E-2.2`);
- ter contribuição individual equilibrada e visível no GitHub, com commits, PRs e revisões distribuídos no tempo (`E-2.1`, `E-7.1`).

### Prazos

| Etapa | Data | Congelamento do repo | Peso |
| --- | --- | --- | --- |
| Parte 2 — Arquitetura | 22/10 e 27/10 | **21/10 às 23h59** | 20% |
| Parte 3 — Containerização | 17/11 | (vídeo no repo) | 20% |
| Parte 4 — Sistema funcionando | 10/12 e 15/12 | **09/12 às 23h59** | 20% |

## 2. Personas

| Persona | Cliente | Necessidade central |
| --- | --- | --- |
| **Adotante** | App Mobile | encontrar animais próximos e compatíveis com a própria rotina e acompanhar o pedido |
| **Protetor independente** | App Web | divulgar os animais sob seus cuidados e avaliar pedidos sem depender de grupos de WhatsApp |
| **ONG** (membro/gestor) | App Web | gerenciar vários animais e pedidos com visão consolidada |
| **Administrador da plataforma** | App Web | verificar ONGs e protetores parceiros (seed/manual no MVP) |
| **Avaliador / terceiro** | README + terminal | subir o sistema do zero e ver cada padrão funcionando |

## 3. Análise de lacunas: enunciado × repositório atual

Legenda: ✅ atendido · 🟡 parcial · ❌ pendente

### 3.1 Transversais (`E-2`)

| ID | Requisito | Situação | Observação |
| --- | --- | --- | --- |
| RT-01 | Repositório público com os 4 integrantes como contribuidores | 🟡 | a cópia local **não é um repositório git**; é preciso clonar `gxbreus/ampara` e trabalhar nele |
| RT-02 | `user.name`/`user.email` corretos e `Co-authored-by` em pares | ✅ (processo) | já descrito no CONTRIBUTING |
| RT-03 | Branches por funcionalidade + PR com revisão de outro integrante | ✅ (processo) | falta proteção de branch no GitHub *(a confirmar)* |
| RT-04 | Commits distribuídos ao longo do semestre | ❌ | exige divisão de trabalho e entregas semanais (ver §10) |
| RT-05 | README com instruções de execução reproduzíveis | ❌ | ainda não existe código |
| RT-06 | `/docs` com diagramas, decisões e contratos de API | 🟡 | contratos ainda vazios |

### 3.2 Parte 2 — Arquitetura (`E-4`)

| ID | Requisito | Situação | O que falta |
| --- | --- | --- | --- |
| RA-01 | 4+ serviços com responsabilidades (`E-4.1`) | ✅ | incluir o 5º serviço **Assistente** (LLM), ver §5 |
| RA-02 | Justificativa das fronteiras, "por que este corte e não outro" (`E-4.1`) | 🟡 | comparar com cortes alternativos rejeitados (ex.: Adoção dentro de Animais; Notificações dentro de Adoção) |
| RA-03 | Diagrama de componentes e de comunicação (`E-4.1`) | 🟡 | atualizar com BFFs, outbox, read model, Assistente e vector DB |
| RA-04 | Contrato OpenAPI completo de cada serviço (`E-4.2`) | ❌ | `docs/contratos/*.yaml` |
| RA-05 | Uso correto de recursos, verbos e status HTTP (`E-4.2`) | ❌ | 201 + `Location`, 202 para iniciar a SAGA, 409 para animal reservado, 422 de validação, 404, 401/403 |
| RA-06 | Estratégia de versionamento justificada (`E-4.2`) | ❌ | proposta: versão maior na URI, depois do cliente nas rotas externas (`/web/v1`, `/mobile/v1`, `/auth/v1`) e sozinha nas internas (`/v1`), com os dois eixos independentes; campo `version` nos eventos (ADR-006, #124) |
| RA-07 | Ao menos 1 recurso com HATEOAS (`E-4.2`) | ❌ | proposta: `SolicitacaoAdocao` com links que dependem do estado (`aprovar`, `recusar`, `cancelar`, `animal`, `adotante`) |
| RA-08 | Gateway com regras de roteamento (`E-4.3`) | 🟡 | definir a tecnologia e a tabela de rotas |
| RA-09 | Responsabilidades do gateway (`E-4.3`) | 🟡 | validação de JWT, rate limiting, correlation ID e CORS |
| RA-10 | 2 BFFs (web e mobile) com justificativa (`E-4.4`) | ❌ | **ainda não existem na arquitetura** |
| RA-11 | Demonstração explícita da diferença das respostas por cliente (`E-4.4`) | ❌ | mesmo animal: payload enxuto no mobile × completo no web |
| RA-12 | Banco por serviço com tecnologia justificada (`E-4.5`) | 🟡 | justificar Redis como banco de Notificações (persistência AOF e TTL) |
| RA-13 | Pontos de consistência eventual (`E-4.5`) | ❌ | ver §6.3 |
| RA-14 | Análise do risco de dual write (`E-4.5`) | ❌ | ver §6.3 |
| RA-15 | Projeto do outbox em pelo menos 1 fluxo (`E-4.5`) | ❌ | Adoção (comandos da SAGA) e Animais (eventos para o read model) |
| RA-16 | Orquestrada × coreografada, com justificativa (`E-4.6`) | 🟡 | já é orquestrada; falta comparar com a coreografia |
| RA-17 | Transação em ≥3 serviços (`E-4.6`) | ✅ | Adoção, Animais, Identidade e Notificações |
| RA-18 | **Todas** as transações compensatórias (`E-4.6`) | 🟡 | a tabela atual não cobre a falha após a aprovação nem a validação de perfil |
| RA-19 | Diagramas de sequência: caminho feliz e ≥1 falha (`E-4.6`) | 🟡 | separar em dois diagramas e incluir a falha técnica (timeout) |
| RA-20 | CQRS em ≥1 serviço com justificativa (`E-4.7`) | ❌ | **não existe**; proposta no §6.4 |
| RA-21 | Atualização do read model e defasagem aceitável (`E-4.7`) | ❌ | proposta: por eventos, p95 ≤ 5 s |

### 3.3 Parte 3 — Containerização e Orquestração (`E-5`)

| ID | Requisito |
| --- | --- |
| RC-01 | Dockerfile próprio para cada serviço, BFF e cliente web |
| RC-02 | Multi-stage build onde couber (Go, NestJS, React), com justificativa medida (tamanho antes × depois) |
| RC-03 | Volumes para todos os bancos (PG ×2, Mongo, Redis, vector DB, RabbitMQ) |
| RC-04 | Redes isoladas: `edge` (gateway ↔ BFFs), `services` (BFFs ↔ serviços ↔ broker), `data-*` (cada serviço só alcança o próprio banco) |
| RC-05 | `docker compose up` sobe tudo com um único comando, incluindo seed |
| RC-06 | Deployment por serviço com réplicas definidas |
| RC-07 | Services (ClusterIP) para a comunicação interna |
| RC-08 | Ingress que espelha as rotas do gateway definidas na Parte 2 |
| RC-09 | ConfigMaps e Secrets; **nenhuma credencial no código** (senão o item zera) |
| RC-10 | Demonstração de escala: aumento de réplicas + evidência de distribuição de carga (ex.: header `X-Served-By` com o nome do pod + teste de carga) |
| RC-11 | Ambiente local (kind/Minikube/k3s) |
| RC-12 | Vídeo ≤10 min com os 4 integrantes explicando partes distintas |

### 3.4 Parte 4 — Sistema em funcionamento (`E-6`)

| ID | Requisito |
| --- | --- |
| RF-01 | Fluxo ponta a ponta ao vivo: cliente → gateway → BFF → serviços |
| RF-02 | SAGA ao vivo: caminho feliz **e** falha com compensação provocada na hora |
| RF-03 | Consulta ao read model do CQRS refletindo uma escrita |
| RF-04 | Bancos separados evidenciados |
| RL-01 | LLM com propósito real no domínio (não chatbot decorativo) |
| RL-02 | RAG: base própria → ingestão → embeddings → base vetorial → recuperação → geração |
| RL-03 | Avaliação do RAG: ≥5 perguntas, com × sem recuperação, com análise |
| RL-04 | LangChain: chains + ≥1 tool que consulte dados reais do sistema |
| RL-05 | Agente opcional; se usado, justificar a necessidade de decisão dinâmica |
| RL-06 | ≥2 mecanismos entre circuit breaker, timeout + retry com backoff, cache e fallback (**proposta: implementar os 4**) |
| RL-07 | Análise de latência medida e custo por operação em escala |

## 4. Histórias de usuário

### MVP (Must)

**Identidade**
- **[HU-01]** Como adotante, quero criar conta pelo app, para solicitar adoções.
  - Aceite: cadastro com nome, e-mail, senha e cidade; e-mail único (409 se repetido); senha armazenada com hash (bcrypt/argon2).
- **[HU-02]** Como protetor ou ONG, quero criar conta no App Web, para cadastrar animais.
  - Aceite: a conta nasce com status `PENDENTE_VERIFICACAO`; só contas `VERIFICADA` publicam animais (no MVP, verificação via seed ou endpoint admin).
- **[HU-03]** Como usuário, quero entrar com e-mail e senha, para acessar as funções do meu perfil.
  - Aceite: retorna um JWT com `sub`, `role` e `exp`; o gateway rejeita token inválido com 401.
- **[HU-04]** Como adotante, quero completar meu perfil de adoção (tipo de moradia, se tem quintal, outros animais, rotina, aceite do termo de adoção responsável), para estar apto a solicitar.
  - Aceite: a SAGA reprova um perfil incompleto; o app mostra o que falta.

**Animais**
- **[HU-05]** Como protetor ou ONG, quero cadastrar um animal com fotos, espécie, porte, idade, sexo, temperamento e localização, para disponibilizá-lo para adoção.
  - Aceite: retorna 201 com `Location`; o animal aparece na busca do mobile em até 5 s (defasagem do CQRS).
- **[HU-06]** Como protetor ou ONG, quero editar o animal e alterar o status (`DISPONIVEL`, `EM_TRATAMENTO`, `INDISPONIVEL`).
  - Aceite: `RESERVADO` e `ADOTADO` só podem ser definidos pela SAGA, nunca manualmente.
- **[HU-07]** Como adotante, quero buscar animais por raio de distância e filtros (espécie, porte, idade), para achar animais perto de mim.
  - Aceite: consulta servida pelo read model; resultados ordenados por distância; paginação por cursor.
- **[HU-08]** Como adotante, quero ver o detalhe de um animal, com fotos e responsável, para decidir se solicito a adoção.
  - Aceite: mostra só o bairro e a cidade, nunca o endereço exato (LGPD).

**Adoção (SAGA)**
- **[HU-09]** Como adotante, quero solicitar a adoção de um animal, para iniciar o processo.
  - Aceite: retorna 202 com o link da solicitação; o animal fica `RESERVADO`; o responsável é notificado. Se o animal já estiver reservado, a solicitação termina como `REJEITADA_INDISPONIVEL` e o adotante é avisado.
- **[HU-10]** Como protetor ou ONG, quero listar as solicitações dos meus animais com dados do adotante, para avaliá-las.
- **[HU-11]** Como protetor ou ONG, quero aprovar ou recusar uma solicitação, para concluir ou encerrar o processo.
  - Aceite: a resposta traz links HATEOAS coerentes com o estado; a aprovação marca o animal como `ADOTADO`; a recusa libera a reserva.
- **[HU-12]** Como sistema, quero expirar automaticamente as solicitações sem resposta, para não prender o animal.
  - Aceite: prazo configurável por ConfigMap (ex.: 72 h em produção, 2 min na demo); dispara a compensação.
- **[HU-13]** Como adotante, quero cancelar a minha solicitação, para desistir sem prender o animal.
- **[HU-14]** Como adotante, quero acompanhar o andamento do meu pedido em uma linha do tempo.

**Notificações**
- **[HU-15]** Como responsável pelo animal, quero ser avisado de novas solicitações.
- **[HU-16]** Como adotante, quero ser avisado a cada mudança de estado (iniciada, aprovada, recusada, expirada, cancelada).
- **[HU-17]** Como usuário, quero ver minhas notificações no app e marcá-las como lidas.
  - Aceite: entrega in-app (polling ou SSE); consumidor idempotente (a mesma mensagem reentregue não duplica o aviso).

**Assistente (LLM)**
- **[HU-18]** Como adotante, quero tirar dúvidas sobre adoção responsável e cuidados por espécie ou porte, com respostas baseadas em fontes confiáveis, para me preparar.
  - Aceite: a resposta cita os trechos da base usados (RAG); se o LLM estiver fora do ar, aparece uma mensagem de fallback e o restante do app continua funcionando.
- **[HU-19]** Como adotante, quero descrever minha rotina (moradia, tempo livre, crianças) e receber sugestões de animais disponíveis compatíveis, para escolher melhor.
  - Aceite: o modelo usa uma **tool** que consulta o read model de Animais (dados reais) e só sugere animais `DISPONIVEL`. Essa é a ligação direta com a causa do abandono citada na Parte 1: a diferença entre expectativa e realidade.

### Próximas entregas (Should / Could)

- **[HU-20]** Como cidadão, quero registrar um avistamento ou uma denúncia com foto e localização, para acionar protetores próximos. — *Should*. Sustenta o indicador "tempo entre avistamento e resgate" prometido na Parte 1.
- **[HU-21]** Como protetor, quero ser alertado de avistamentos no meu raio de atuação. — *Should*
- **[HU-22]** Como ONG, quero que o assistente sugira uma descrição atraente para o animal a partir dos dados cadastrados. — *Could*
- **[HU-23]** Como ONG, quero um painel com indicadores de impacto (adoções por mês, tempo médio até a adoção). — *Should*, e fica natural como segundo read model.
- **[HU-24]** Como administrador, quero aprovar a verificação de ONGs pela interface. — *Could* (no MVP é feito por seed ou API)
- **[HU-25]** Push nativo (FCM/Expo). — *Could* (o MVP usa notificação in-app)

## 5. Decomposição proposta (atualização da arquitetura)

| Componente | Tecnologia | Banco | Papel |
| --- | --- | --- | --- |
| API Gateway | Kong 3.8 DB-less (Kong Ingress Controller na Parte 3) | — | roteamento, JWT, rate limit, correlation ID |
| BFF Web | Node 22 + TypeScript + Fastify | — | agrega dados para o painel de ONGs |
| BFF Mobile | Node 22 + TypeScript + Fastify | — | payloads enxutos e agregação para o adotante |
| Identidade | NestJS | PostgreSQL | contas, perfis, verificação, limite de solicitações ativas |
| Animais | FastAPI | MongoDB (escrita) + projeção de leitura | catálogo, reserva, **CQRS** |
| Adoção | Go | PostgreSQL (+ tabela outbox) | **orquestrador da SAGA**, HATEOAS |
| Notificações | FastAPI | Redis (AOF) | consumo de eventos, caixa de entrada por usuário |
| **Assistente** (novo) | Python + LangChain | Qdrant + cache em `redis-assistente` | RAG, tool de busca de animais, resiliência do LLM |
| Broker | RabbitMQ | — | comandos e eventos, DLQ |
| App Web | React + Vite | — | protetores e ONGs |
| App Mobile | Expo (React Native) | — | adotantes |

**Por que o Assistente é um serviço próprio:** o LLM é uma dependência remota lenta, cara e falível. Isolado, ele tem a própria política de escala, circuit breaker e cache, e uma queda não afeta a busca nem a SAGA.

## 6. Requisitos de arquitetura detalhados

### 6.1 Gateway e BFF

Rotas propostas:

| Rota externa | Destino | Autenticação |
| --- | --- | --- |
| `/auth/v1/*` | Identidade | pública (rate limit mais rígido) |
| `/web/v1/*` | BFF Web | JWT, roles `PROTETOR`, `ONG` e `ADMIN` |
| `/mobile/v1/*` | BFF Mobile | JWT, role `ADOTANTE` (busca pública) |

Os serviços de domínio **não** ficam expostos para fora. No Kubernetes, o Ingress reproduz essa mesma tabela (`RC-08`).

Diferença de resposta a demonstrar (`RA-11`), usando o mesmo animal:
- **mobile:** `id`, `nome`, `fotoThumb`, `distanciaKm`, `porte` e `statusMinhaSolicitacao`;
- **web:** todos os campos, histórico de status, solicitações vinculadas com dados do adotante e contadores.

### 6.2 SAGA de adoção (orquestrada pelo serviço de Adoção)

**Comunicação proposta:** comandos e respostas via RabbitMQ, saindo pelo outbox, em vez de HTTP síncrono. Assim a SAGA sobrevive à indisponibilidade temporária de um participante e o outbox fica com uso real. *(A confirmar, porque muda o diagrama atual do README.)*

| # | Passo | Serviço | Compensação |
| --- | --- | --- | --- |
| T1 | Reservar o animal (`DISPONIVEL` → `RESERVADO`) | Animais | C1: liberar a reserva (`RESERVADO` → `DISPONIVEL`) |
| T2 | Validar o perfil e ocupar uma vaga de solicitação ativa (limite: 1 por adotante) | Identidade | C2: liberar a vaga |
| T3 | Notificar o responsável | Notificações | sem compensação (é idempotente e pode ser repetido) |
| — | *Aguarda a decisão humana: aprovar, recusar, expirar ou cancelar* | Adoção | — |
| T4 | Confirmar a adoção (`RESERVADO` → `ADOTADO`) — **pivô** | Animais | após o pivô, só seguem passos retentáveis |
| T5 | Registrar a adoção no histórico do adotante e liberar a vaga | Identidade | retentável |
| T6 | Notificar o adotante e o responsável | Notificações | retentável |

Cenários de falha que precisam de diagrama e de demonstração ao vivo:

1. **Perfil incompleto** (regra de negócio): falha no T2, executa C1 e avisa o adotante. *Fácil de provocar na apresentação.*
2. **Recusa ou expiração**: executa C2 e C1 e avisa o adotante.
3. **Animal já reservado** (concorrência): falha no T1, encerra sem compensação.
4. **Identidade fora do ar** (falha técnica): derrubar o pod durante a demo; o orquestrador espera até o timeout e então executa C1.

Requisitos do orquestrador:
- persistir o estado antes de cada passo;
- comandos idempotentes (`sagaId` + `step`);
- `correlationId` em todos os logs e mensagens;
- ao reiniciar, retomar as SAGAs que estavam em andamento.

### 6.3 Database per service, consistência eventual e outbox

**Pontos de consistência eventual:**
- read model de busca de Animais;
- nome e status de verificação da ONG copiados (desnormalizados) na projeção de Animais;
- status "reservado" visível no mobile durante a SAGA;
- caixa de notificações.

**Riscos de dual write:**
- Adoção grava o estado e publica o comando → resolvido pelo **outbox** (tabela `outbox` na mesma transação PG + relay que publica no RabbitMQ);
- Animais grava no Mongo e publica `animal.atualizado` → outbox em coleção Mongo, também com relay;
- Identidade publica `conta.verificada` → outbox *(Should)*.

**Do lado do consumidor:** tabela ou chave de *inbox* para idempotência e DLQ após N tentativas.

### 6.4 CQRS (serviço Animais)

- **Por que Animais:** a carga é muito assimétrica (muitas buscas geográficas do mobile contra poucas escritas das ONGs), e a busca precisa de dados desnormalizados (nome da ONG, foto de capa, índice geográfico) que não pertencem ao modelo de escrita.
- **Escrita:** coleção `animais`, normalizada, com histórico de status e regras de transição.
- **Leitura:** projeção `animais_busca`, com índice `2dsphere`, desnormalizada, consultada pelo BFF Mobile e pela tool do Assistente.
- **Atualização:** eventos `animal.*` saem pelo outbox, um projetor consome e grava (upsert idempotente por `version`).
- **Defasagem aceitável:** p95 ≤ 5 s. A resposta da busca traz `atualizadoEm` para tornar a defasagem visível na demo (`RF-03`).
- **Alternativa considerada e rejeitada:** CQRS em Adoção (o painel da ONG); fica como segundo read model *Should* (HU-23).

### 6.5 LLM (serviço Assistente)

- **Base de conhecimento** *(a confirmar o conteúdo)*: guias de adoção responsável e de guarda responsável (CRMV, conselhos e prefeituras), cuidados por espécie, porte e idade, a legislação já citada (Lei 9.605/98 e Lei 14.064/20), e o FAQ e o termo de adoção da Ampara.
- **Pipeline:** script de ingestão → chunking → embeddings → base vetorial → retriever → chain de geração com citação das fontes.
- **Tools (LangChain):**
  - `buscar_animais_disponiveis(especie, porte, raio, ...)`, que consulta o read model;
  - `status_minha_solicitacao(id)`, que consulta Adoção *(Should)*.
- **Agente:** usar *apenas* em HU-19, onde o modelo decide se chama a busca e com quais filtros a partir de um texto livre. Isso justifica a decisão dinâmica (`RL-05`); HU-18 fica como chain fixa.
- **Resiliência (os 4 mecanismos):**
  - timeout de 15 s;
  - retry com backoff exponencial e jitter (3 tentativas, só para 429/5xx);
  - circuit breaker (abre após 5 falhas em 30 s, half-open após 60 s);
  - cache por chave (hash de pergunta normalizada + versão da base) no Redis próprio, ou cache semântico *(Could)*;
  - fallback: modelo secundário ou resposta somente com os trechos recuperados, sem geração.
- **Medições:** latência p50/p95 por etapa (recuperação × geração), tokens por chamada → custo por operação e projeção para 1k, 10k e 100k perguntas por mês.
- **Avaliação:** ≥10 perguntas (o mínimo é 5), comparando com e sem RAG, com critérios de correção, fundamentação e alucinação, registrada em `docs/llm/avaliacao-rag.md`.

## 7. Requisitos não-funcionais

- **Desempenho:** no ambiente local, busca p95 < 500 ms; SAGA até `AGUARDANDO_APROVACAO` em < 3 s; Assistente p95 < 8 s (medido e documentado).
- **Segurança:**
  - JWT validado no gateway;
  - roles verificadas nos BFFs e serviços;
  - hash de senha;
  - Secrets do Kubernetes para todas as credenciais, com `.env.example` sem valores reais;
  - serviços de domínio inacessíveis de fora.
- **Privacidade/LGPD:**
  - coletar o mínimo necessário (CPF fora do MVP *(a confirmar)*);
  - localização pública aproximada;
  - consentimento no termo de adoção;
  - exclusão de conta (*Should*);
  - não enviar dados pessoais ao provedor de LLM.
- **Resiliência:** retries com backoff entre serviços, DLQ no RabbitMQ, consumidores idempotentes, health e readiness probes em todos os serviços.
- **Observabilidade:** logs JSON com `correlationId`; endpoint ou log que mostre o estado da SAGA; Prometheus/Grafana/Jaeger *(Could)*.
- **Reprodutibilidade:** `docker compose up` em uma máquina limpa; seed de demonstração (ONGs, animais e adotantes, um deles com perfil incompleto para provocar a falha); README passo a passo.
- **Compatibilidade:** web nos navegadores atuais; mobile em Android via Expo Go ou emulador.
- **Acessibilidade:** contraste e rótulos básicos (*Should*).
- **Qualidade:** testes unitários das regras de transição de estado e um teste de integração da SAGA (*Should*); CI no GitHub Actions com lint e build (*Should*, e ainda reforça o histórico de PRs).

## 8. MVP

HU-01 a HU-19, junto com **todos** os itens RA, RC, RF e RL. Na prática, o MVP é o que a Parte 4 exige ao vivo: um adotante encontra um animal, solicita, a ONG aprova ou recusa, a falha é compensada, a busca reflete a escrita e o assistente orienta e recomenda com dados reais.

## 9. Backlog (pós-MVP)

HU-20 a HU-25, segundo read model (painel de impacto), cache semântico, observabilidade completa (Prometheus/Grafana/Jaeger), HPA com métricas, CI/CD.

## 10. Fora de escopo

- Pagamentos e doações: não fazem parte do problema central e trariam risco regulatório.
- Chat entre adotante e ONG: o contato acontece depois da aprovação, por fora.
- Verificação documental real de ONGs (CNPJ ou documentos): no MVP é manual ou por seed.
- Publicação nas lojas de apps e deploy em nuvem: o enunciado aceita ambiente local.
- Upload de fotos para storage externo (S3): no MVP as fotos ficam como URL.

## 11. Decisões confirmadas (2026-10-06)

- A SAGA se comunica por **comandos e respostas via RabbitMQ**, com outbox no serviço de Adoção.
- O LLM fica em um **5º serviço, o Assistente** (Python + LangChain), com base vetorial própria.
- **Avistamentos e denúncias** entram como *Should*, depois do MVP.
- O desenvolvimento será **dividido por integrante** (ver `docs/planejamento.md`).

### Decisões do kickoff (2026-10-07, #19)

Votadas de forma assíncrona; o grupo aprovou todas as recomendações.

| # | Decisão | Escolha |
| --- | --- | --- |
| 1 | Donos por serviço | divisão de `docs/planejamento.md` §4, sem trocas |
| 2 | API Gateway | Kong 3.8 DB-less; Kong Ingress Controller na Parte 3 |
| 3 | Framework dos BFFs | Node 22 + TypeScript + Fastify |
| 4 | Base vetorial do Assistente | Qdrant + cache de respostas em `redis-assistente` |
| 5 | App Web | React + Vite |
| 6 | App Mobile | Expo (React Native) |
| 7 | LLM e orçamento | custo zero: free tier da Groq como modelo principal (ex.: `gpt-oss-120b`, com suporte a tools), Ollama local como fallback e embeddings locais multilíngues (ex.: `bge-m3`); a troca de provedor depende só de variáveis de ambiente (#67) |
| 8 | Cluster local | kind |
| 9 | Fotos dos animais | URL no MVP |
| 10 | Algoritmo do JWT | RS256: a Identidade assina; gateway, BFFs e serviços validam com a chave pública |
| 11 | Read model do CQRS | database `animais_leitura` na mesma instância `mongo-animais` |
| 12 | Formato do HATEOAS | HAL (`_links`, `_embedded`) |
| 13 | Versionamento | versão maior na URI; `version` no envelope dos eventos |
| 14 | MongoDB | replica set de 1 nó (`rs0`) |
| 15 | Filas | quorum queues com `x-delivery-limit: 5` e DLX `ampara.dlx` |
| 16 | Merge | squash nos PRs para `develop`; merge commit nos releases `develop` → `main` |
| 17 | Ritmo | check-in assíncrono toda terça (entregue, próximo, bloqueios); chamada de 15 min só sob demanda; 1 PR aberto e 1 revisado por pessoa por semana |

## 12. Premissas e pontos a confirmar

1. Canal assíncrono do grupo para o check-in semanal (WhatsApp, Discord ou discussões do GitHub). *(a confirmar)*
2. Quem cria a chave da Groq usada na demo e como ela chega ao Kubernetes (Secret criado à mão, nunca no repositório). Para desenvolvimento, cada integrante usa a própria chave, porque o limite do free tier vale por organização. *(a confirmar)*
