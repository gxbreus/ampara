# Conferência parcial do Kubernetes — #49

Registro de 2026-11-17 na branch existente `feature/k8s-notificacoes-assistente`,
PR #169, preservando seus commits e autores. PRs #168, #169 e #170 consultados:
abertos, sem merge; #168 e #169 sem revisões submetidas naquele momento.
Nenhum merge, aprovação própria ou force-push foi realizado.

## Validação executada

`kubectl kustomize` foi executado offline, separadamente para os diretórios
`k8s/notificacoes` e `k8s/assistente`, em cópias temporárias. Os `secret.env`
dessas cópias usaram valores fictícios de teste; LLM_API_KEY ficou vazia.
Nenhum Secret real foi lido, impresso ou aplicado no cluster.

- Notificações: **5 recursos renderizados**; namespace ampara, Deployment com
  duas réplicas e Secret de conexão conferidos.
- Assistente: **8 recursos renderizados**; namespace ampara, duas réplicas e
  campo LLM_API_KEY vazio no Secret renderizado conferidos.
- Inspeção estática: Redis de Notificações tem senha por Secret, AOF e PVC de
  1 Gi; everysec é o padrão implícito. Qdrant usa v1.12.6, igual ao Compose,
  e PVC de 1 Gi. Redis de cache tem uma réplica, 96 MB, allkeys-lru e sem PVC.
- Não há chave JWT privada nesses dois diretórios. Quando #60/#67 adicionarem
  validação JWT, montar somente a chave pública, nunca reutilizar o Secret
  com a chave privada da Identidade no pod desses serviços.

Renderizar YAML não valida disponibilidade, senha funcional, armazenamento no
kind, limites reais de memória ou recuperação. Nenhum pod foi criado aqui.

## Integração ainda necessária

1. Integrar #168 e as implementações #41/#42 na develop, após revisão da equipe.
2. Só então trocar readiness de `/health` para `/ready` nos dois Deployments;
   manter liveness em `/health`. Hoje o PR usa `/health` nas duas probes.
   Não implantar essa troca contra a imagem antiga, que não possui `/ready`.
3. Acrescentar EMBEDDINGS_PROVIDER/EMBEDDINGS_MODEL no ConfigMap ao integrar
   #66, mantendo os nomes usados pelo serviço. Conferir URL do provedor local.
4. Construir e carregar as imagens novas no kind; medir consumo real com as
   dependências do LangChain antes de confirmar que 256 Mi bastam no Assistente.
5. Aplicar e verificar `kubectl get deploy,statefulset,pods -n ampara`, inclusive
   Assistente Ready com a chave LLM vazia.
6. Executar persistência com conteúdo antes/depois de recriar os pods. Os
   procedimentos preparados estão no PR #162, trecho do Gabriel; ainda não
   são evidência de execução. Redis deve recuperar a chave e Qdrant o ponto
   e sua coleção, sem executar ingestão novamente entre as leituras.

Engine Docker Linux indisponível neste ambiente: os passos em kind não foram
executados. Não preencher Ready 2/2, tempos, screenshots ou persistência como
comprovados. A issue #49 continua aberta; esta contribuição usa `Refs #49`.
Publicação do commit depende de autenticação Git ou escrita no conector.
