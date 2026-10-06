# Escopo, cronograma e kickoff — Ampara

Cliente: disciplina de Sistemas Distribuídos · Data: 2026-10-06 · Versão: 0.1 · Base: [requisitos.md](requisitos.md)

## 1. Entendimento do projeto

A Ampara precisa sair de uma arquitetura descrita para um sistema distribuído executável que mostre, ao vivo, cada padrão cobrado pela disciplina sobre um domínio com impacto social real: adoção responsável de animais. O sistema e o processo contam na nota: cada integrante precisa de contribuição própria, visível e distribuída no tempo.

## 2. Escopo incluído

- **Parte 2:**
  - arquitetura documentada: decomposição e justificativa das fronteiras;
  - contratos OpenAPI dos 5 serviços e dos 2 BFFs;
  - catálogo de eventos e comandos;
  - gateway e rotas, BFFs;
  - database per service, consistência eventual, dual write e outbox;
  - SAGA com todas as compensações e diagramas;
  - CQRS;
  - ADRs de cada decisão.
- **Parte 3:**
  - Dockerfiles multi-stage, compose com redes e volumes;
  - manifests Kubernetes (Deployments, Services, Ingress, ConfigMaps, Secrets);
  - demonstração de escala;
  - vídeo.
- **Parte 4:**
  - serviços implementados, BFFs, App Web e App Mobile;
  - SAGA com compensação ao vivo, CQRS ao vivo;
  - Assistente com RAG, LangChain + tool e os 4 mecanismos de resiliência;
  - avaliação do RAG, análise de latência e custo;
  - seed e roteiro de demonstração.

## 3. Escopo não incluído

Pagamentos e doações, chat, verificação documental real, publicação nas lojas de apps, deploy em nuvem e storage externo de fotos. Avistamentos e denúncias ficam no backlog *Should*, ver [requisitos §9](requisitos.md#9-backlog-pós-mvp).

## 4. Divisão por integrante *(proposta, a confirmar)*

Cada pessoa é **dona** de um serviço de domínio do começo ao fim: contrato, código, Dockerfile, manifest K8s e a parte do vídeo e da apresentação sobre ele. Também assume uma peça transversal e **revisa os PRs** de um colega fixo. Na arguição, o docente escolhe quem responde, então cada dono precisa dominar a própria parte e conhecer o fluxo da SAGA inteiro.

| Integrante | Serviço de domínio | Peça transversal | Revisa PRs de |
| --- | --- | --- | --- |
| **Mateus Vitor** | **Adoção** (Go): orquestrador da SAGA, outbox, HATEOAS | **BFF Web**, topologia do RabbitMQ, catálogo de eventos, `compose.yaml`, seed, CI | Gabriel Cantanhede |
| **Gabriel Soares** | **Identidade** (NestJS): contas, JWT, perfil, vagas da SAGA | **API Gateway** + **Ingress** + **App Web** | Mateus Vitor |
| **Gabriel Cantanhede** | **Animais** (FastAPI): CQRS, projeção, outbox Mongo | **BFF Mobile** + **App Mobile** | Gabriel Nakazato |
| **Gabriel Nakazato** | **Assistente** (LangChain): RAG, tool, resiliência, avaliação | **Notificações** (FastAPI/Redis) + tela do assistente no App Mobile | Gabriel Soares |

Responsabilidades compartilhadas, com rodízio de autoria nos PRs:
- README de execução;
- seed de demonstração;
- demonstração de escala no Kubernetes;
- slides e roteiro da demo;
- CI (GitHub Actions).

## 5. Entregáveis por fase

### Fase A — Arquitetura (até o congelamento de 21/10 às 23h59)

| Entregável | Caminho | Dono |
| --- | --- | --- |
| Arquitetura revisada (componentes, BFFs, Assistente, outbox, read model) | `docs/arquitetura.md` | Mateus |
| Justificativa das fronteiras + cortes alternativos rejeitados | `docs/arquitetura.md` | todos (cada um escreve a do próprio serviço) |
| OpenAPI de Identidade | `docs/contratos/identidade.v1.yaml` | G. Soares |
| OpenAPI de Animais (escrita + busca) | `docs/contratos/animais.v1.yaml` | G. Cantanhede |
| OpenAPI de Adoção com **HATEOAS** | `docs/contratos/adocao.v1.yaml` | Mateus |
| OpenAPI de Notificações e do Assistente | `docs/contratos/notificacoes.v1.yaml`, `assistente.v1.yaml` | G. Nakazato |
| OpenAPI dos BFFs + exemplos de resposta web × mobile | `docs/contratos/bff-web.v1.yaml`, `bff-mobile.v1.yaml` | Mateus / G. Cantanhede |
| Catálogo de comandos e eventos (nome, versão, produtor, consumidores, schema) | `docs/contratos/eventos.md` | Mateus |
| Gateway: tabela de rotas, plugins e responsabilidades | `docs/gateway.md` + `kong.yml` rascunho | G. Soares |
| SAGA: estados, compensações, diagramas do caminho feliz e de 3 falhas | `docs/saga.md` | Mateus |
| Database per service, consistência eventual, dual write, outbox | `docs/dados.md` | G. Cantanhede + Mateus |
| CQRS: modelos, projeção, defasagem | `docs/cqrs.md` | G. Cantanhede |
| ADRs 002–007 | `docs/decisoes/` | cada um, a do próprio tema |

ADRs previstas:
- 002: SAGA orquestrada via mensagens;
- 003: outbox;
- 004: CQRS em Animais;
- 005: gateway e BFF;
- 006: versionamento;
- 007: serviço Assistente.

**Protótipo opcional, que vale a pena:** esqueleto de cada serviço com `/health`, para começar a Parte 3 adiantado.

### Fase B — Containerização (até 17/11)

- **Cada dono:**
  - Dockerfile multi-stage do próprio serviço, com tamanho da imagem antes × depois registrado;
  - Deployment + Service + ConfigMap + Secret do serviço;
  - probes de health e readiness.
- **Mateus:** `compose.yaml` com as redes `edge`, `services` e `data-*` e os volumes de todos os bancos.
- **G. Soares:** Ingress que espelha as rotas do gateway.
- **Todos:** demonstração de escala (réplicas 1 → 3 + teste de carga com header `X-Served-By`) e o vídeo, com cada um gravando o próprio trecho.
- **Mínimo funcional nesta fase:** CRUD real de cada serviço + login + rota pelo gateway. A SAGA completa pode ficar para a Fase C.

### Fase C — Sistema funcionando (até o congelamento de 09/12 às 23h59)

- SAGA completa com outbox, idempotência, timeout e expiração configurável.
- Projeção do CQRS e busca geográfica.
- BFFs agregando dados.
- App Web (painel da ONG) e App Mobile (busca, solicitação, linha do tempo, notificações, assistente).
- **Assistente:**
  - ingestão;
  - tool `buscar_animais_disponiveis`;
  - circuit breaker, retry, cache e fallback;
  - medições de latência e custo;
  - `docs/llm/avaliacao-rag.md` (≥10 perguntas, com × sem RAG).
- Seed de demonstração, roteiro da demo e README testado em máquina limpa.

## 6. Cronograma (faixas e marcos)

As tarefas estão no [AMPARA — Board](https://github.com/users/mateus-vitor-ferreira-dev/projects/7). As semanas começam na terça: S1 = 06–12/10, S2 = 13–19/10, …, S10 = 08–14/12.

| Semana | Período | Marco | Critério de conclusão |
| --- | --- | --- | --- |
| S1 | 06–12/10 | Kickoff + contratos v0 | repo clonado e protegido, board criado, OpenAPI v0 de cada serviço em PR |
| S2 | 13–19/10 | Arquitetura completa | `saga.md`, `cqrs.md`, `dados.md`, `gateway.md`, `eventos.md` e ADRs revisados e mesclados |
| — | 20–21/10 | Ensaio + **congelamento às 23h59 de 21/10** | slides prontos, cada um explica a própria parte e a SAGA inteira |
| — | 22 ou 27/10 | **Parte 2** | — |
| S4–S5 | 28/10–09/11 | Serviços mínimos + Docker | cada serviço sobe no compose com o próprio banco; login + CRUD pelo gateway |
| S6 | 10–16/11 | Kubernetes + vídeo | `kubectl apply` sobe tudo; escala demonstrada; vídeo no repo |
| — | 17/11 | **Parte 3** | — |
| S7–S8 | 18/11–30/11 | SAGA + CQRS + BFFs + clientes | fluxo ponta a ponta e as 3 falhas compensando |
| S5–S9 (paralelo) | 28/10–07/12 | Assistente | base coletada em out/nov, pipeline em nov, avaliação e custo até 07/12 |
| S9 | 01–08/12 | Integração e ensaio | demo roda do zero em máquina limpa seguindo o README |
| — | **09/12 às 23h59** | Congelamento | — |
| — | 10 ou 15/12 | **Parte 4** | — |

**Regra de ritmo:** cada integrante abre pelo menos 1 PR e revisa pelo menos 1 PR por semana. Isso distribui o histórico (`E-2.1`) e evita concentrar tudo na véspera.

## 7. Premissas

- Os 4 integrantes concordam com a divisão do §4. Se não concordarem, a tabela é refeita antes do fim da S1.
- Haverá orçamento pequeno para a API do LLM, na casa de dezenas de reais. Sem orçamento, o plano é usar o Ollama local como modelo principal, o que muda a análise de custo.
- As máquinas do grupo rodam Docker e kind/Minikube com pelo menos 8 GB livres. Caso contrário, os manifests vão reduzir as réplicas e um cluster pode ser compartilhado.

## 8. Riscos e mitigação

| Risco | Impacto | Prob. | Mitigação |
| --- | --- | --- | --- |
| Contribuição desigual ou código concentrado em uma pessoa | A (nota individual) | M | donos por serviço, regra de 1 PR por semana, revisão cruzada fixa |
| SAGA via mensageria mais complexa que o previsto | A | M | começar pelo caminho feliz com HTTP atrás de uma interface e trocar o transporte; testes do orquestrador cedo |
| Stack poliglota (Go, Node, Python ×3) pesada para rodar localmente | M | A | limites de memória no compose, réplicas mínimas, imagens slim/distroless |
| LLM indisponível ou caro na demo | A | M | fallback + cache pré-aquecido com as perguntas da demo + Ollama local |
| README não reproduzível na verificação | A | M | ensaio em máquina limpa na S9; `make up` ou script único; `.env.example` |
| Credencial esquecida no código (zera um item da Parte 3) | A | B | `gitleaks` na CI, Secrets apenas via `kubectl create secret` ou template |
| A falha ao vivo não acontece como planejado | A | B | falha determinística por seed (adotante com perfil incompleto) + expiração de 2 min + `kubectl scale identidade --replicas=0` |

## 9. Kickoff

### Checklist

- [ ] Clonar `gxbreus/ampara` (a pasta local atual não é um repositório git) e mover para lá `docs/requisitos.md` e `docs/planejamento.md`.
- [ ] Criar a branch `develop` e proteger `main` e `develop` (PR obrigatório, 1 aprovação, sem auto-aprovação).
- [ ] Cada integrante confere o `git config user.name`/`user.email`.
- [x] Criar o board ([AMPARA — Board](https://github.com/users/mateus-vitor-ferreira-dev/projects/7)) com uma issue para cada entregável do §5, com o dono atribuído.
- [ ] Confirmar a divisão do §4 e as tecnologias pendentes em [requisitos §12](requisitos.md#12-premissas-e-pontos-a-confirmar).
- [ ] Definir o provedor de LLM e o orçamento.
- [ ] Combinar o canal do grupo e uma reunião semanal curta (15 min).

### Definição de Pronto

Uma tarefa está pronta quando:
- atende aos critérios de aceite da HU ou ao item RA/RC/RF/RL correspondente;
- o contrato em `docs/contratos` foi atualizado, se a interface mudou;
- tem teste ou um passo de verificação descrito no PR;
- sobe via compose sem passos manuais extras;
- foi aprovada por outro integrante em PR para `develop`;
- não contém credenciais no código.

### Primeiros passos (S1)

1. Kickoff de 30 min com os 4 integrantes: validar §4 e os pontos a confirmar.
2. Cada dono abre `feature/contrato-<servico>` com o OpenAPI v0 do próprio serviço.
3. Mateus abre `feature/catalogo-eventos` e `feature/saga-modelagem`.
4. G. Soares abre `feature/gateway-rotas`.
5. G. Nakazato começa a reunir as fontes da base de conhecimento do RAG (PDFs e guias oficiais).
