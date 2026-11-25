# Conferência em máquina limpa — #73

**Situação em 17/11/2026:** não executado em máquina limpa. Este é o roteiro
para alguém que nunca rodou o projeto; preencher após execução real, sem ajuda
verbal. O teste local do gerador de `.env` não substitui esse ensaio.

## Antes de começar

- [ ] Pessoa de fora do grupo, sem checkout/volumes anteriores da Ampara.
- [ ] Registrar commit, SO, CPU, RAM, versões de Git, Python/OpenSSL e Docker/Compose.
- [ ] Seguir apenas o [README](../../README.md#como-executar) e anotar todo passo ambíguo.
- [ ] Para Kubernetes: registrar kind, kubectl, Helm e recursos disponíveis nos workers.

## Docker Compose

- [ ] Clone + configuração + subida em até cinco comandos do README.
- [ ] Gerador cria `.env` sem imprimir credenciais e recusa sobrescrever um arquivo existente.
- [ ] `docker compose up -d --build --wait` termina sem erro.
- [ ] `docker compose ps` mostra os componentes esperados saudáveis em até cinco minutos.
- [ ] Depois da #71: seed termina com exit 0; usuários de demonstração autenticam.
- [ ] Depois da #43/#45: busca pública retorna resposta pelo gateway em `:8000`.
- [ ] Login de adotante e ONG funciona; rotas privadas rejeitam ausência de JWT.
- [ ] App Web lista os animais da ONG; App Mobile abre no navegador do telefone pelo IP local (porta 5174).
- [ ] Os cinco cenários da #71 alcançam os estados esperados sem alteração manual de banco.
- [ ] Uma escrita aparece no read model; registrar tempo medido.
- [ ] Assistente sem chave responde em contingência, com fontes, sem interromper busca/adoção.
- [ ] Mensagem de teste na DLQ identificada, causa corrigida, reprocessada e fluxo conferido.
- [ ] Reiniciar os containers preserva os dados dos bancos.

## Kubernetes

- [ ] `scripts/k8s-prep.sh` gera apenas credenciais locais ignoradas pelo Git.
- [ ] Todas as imagens necessárias carregadas no kind.
- [ ] `kubectl apply -k k8s/` e instalação do Kong do README funcionam.
- [ ] `kubectl get pods -n ampara` mostra todos os pods esperados prontos.
- [ ] Ingress atende as mesmas rotas do Compose em teste separado, sem disputa de porta.
- [ ] Recriar um pod de banco mantém os dados.
- [ ] Duas réplicas de Animais/BFF Mobile funcionam; escala para três cabe nos workers.

## Registro real

| Campo | Execução 1 | Execução após correções |
| --- | --- | --- |
| Data/hora e fuso | pendente | pendente |
| Pessoa que executou | pendente | pendente |
| Commit/branch | pendente | pendente |
| SO, CPU, RAM | pendente | pendente |
| Versões das ferramentas | pendente | pendente |
| Tempo até healthy | pendente | pendente |
| Tempo total | pendente | pendente |
| Passos que exigiram ajuda | pendente | pendente |
| Falhas e correções/issue | pendente | pendente |
| Logs/screenshots sem segredos | pendente | pendente |

## Revisão por serviço

| Integrante | Trecho | Revisão/evidência |
| --- | --- | --- |
| Gabriel Cantanhede | Animais, Mongo e BFF/App Mobile | pendente |
| Gabriel Soares | Identidade e Gateway | pendente |
| Mateus Vitor | Adoção, Orquestrador e BFF Web | pendente |
| Gabriel Nakazato | Notificações, Assistente, Redis e Qdrant | pendente |

Só encerre #73 quando houver execução real por terceiro e revisão dos quatro.

Conferência estática de 2026-11-17: trecho de Notificações/Assistente atualizado
com variáveis, portas, logs, health/ready e diferenças de persistência, considerando
os PRs #168/#169 ainda abertos. Não é aprovação humana do PR nem teste de runtime.
O critério de `.env.example` com valores de exemplo continua pendente: o gerador
produz credenciais locais, mas o template mantém os campos de segredo vazios.
