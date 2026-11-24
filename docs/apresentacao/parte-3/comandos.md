# Parte 3: roteiro de apresentação

Roteiro da demonstração da Parte 3, usado na apresentação e no vídeo. Cada bloco traz os comandos de uma etapa, com um comentário sobre o que cada um faz, para rodar no terminal do Codespace (**Ctrl+`** abre o terminal). Os blocos seguem a ordem da apresentação. Os tempos foram medidos num Codespace de 4 núcleos e 16 GB.

> **No Codespace:** o compose responde em `localhost:8080` e o kind (Ingress) em `localhost:8000`, para os dois rodarem juntos.
> **Busca em tabela:** o `./scripts/buscar-animais.sh` faz a mesma chamada do app mobile (`GET /mobile/v1/animais`, 10 km em volta de Lavras) e mostra o resultado como tabela. Sem argumento, usa o Ingress do kind (8000); com `8080`, o gateway do compose. Para ver o JSON cru: `curl -s "localhost:8000/mobile/v1/animais?lat=-21.24&lng=-45.00&raioKm=10" | jq`.
> **No notebook:** o compose responde em `localhost:8000`. Rode só um dos dois de cada vez, porque ambos usam a porta 8000.

## 0. Antes da aula: conferir que tudo voltou

Ao reabrir o Codespace, os containers voltam sozinhos em cerca de 4 minutos, sem build.

```bash
# todos os pods do cluster devem ficar 1/1 Running
kubectl get pods -A

# busca pública pelo Ingress do kind, em tabela: deve listar os 8 animais do seed
# (um 502 nos primeiros minutos é normal: o Kong ainda está reconfigurando as rotas)
./scripts/buscar-animais.sh

# a mesma busca pelo gateway do compose
./scripts/buscar-animais.sh 8080
```

## 1. Docker: imagens próprias e multi-stage

```bash
# as imagens do projeto e o tamanho de cada uma (Go com distroless: cerca de 20 MB)
docker image ls --filter reference='ampara/*'

# um Dockerfile multi-stage: etapa de build com o compilador, etapa final só com o binário
cat services/adocao/Dockerfile
```

## 2. Compose: subir o sistema com um comando (cerca de 1 min)

```bash
# derruba todos os containers; os volumes (dados dos bancos) ficam
docker compose down

# sobe os 17 containers e espera todos ficarem saudáveis
docker compose up -d --wait

# todos devem aparecer como "healthy"
docker compose ps

# redes isoladas por camada: edge, services e uma data-* por banco
docker network ls --filter label=com.docker.compose.project=ampara

# um volume por banco: os dados sobreviveram ao "down"
docker volume ls --filter label=com.docker.compose.project=ampara

# prova da persistência: os animais continuam lá depois do down/up
./scripts/buscar-animais.sh 8080
```

## 3. Kubernetes: subir do zero (cerca de 2 min)

```bash
# o cluster kind: 1 control-plane e 2 workers
kubectl get nodes

# apaga o sistema inteiro do cluster, com os bancos (cerca de 40 s)
kubectl delete namespace ampara

# sobe tudo de novo a partir dos manifests (kustomize)
kubectl apply -k k8s/

# acompanha os pods nascendo nos dois workers; Ctrl+C quando todos ficarem 1/1 (cerca de 1,5 min)
kubectl get pods -n ampara -o wide -w
```

## 4. Deployments, Services, ConfigMaps e Secrets

```bash
# Deployments com o número de réplicas de cada serviço
kubectl get deployments -n ampara

# StatefulSets dos bancos, com volume próprio (PVC)
kubectl get statefulsets,pvc -n ampara

# Services: o endereço interno estável de cada serviço
kubectl get services -n ampara

# configuração externalizada: ConfigMaps (sem segredo) e Secrets (credenciais)
kubectl get configmaps,secrets -n ampara

# um ConfigMap aberto: URLs internas e prazos da SAGA
kubectl describe configmap adocao-config -n ampara

# um Secret mostra só os nomes das chaves, nunca os valores
kubectl describe secret adocao-secret -n ampara
```

## 5. Ingress: as rotas do gateway da Parte 2

```bash
# cada rota do gateway virou um recurso Ingress, com os plugins do Kong por anotação
kubectl get ingress -n ampara

# rate limit e JWT como recursos do Kong
kubectl get kongplugins -n ampara

# 401 sem token, busca pública liberada e 429 quando passa do rate limit
./scripts/teste-rotas.sh
```

## 6. Seed: o sistema funcionando (banco vazio → dados)

```bash
# depois do passo 3 o banco está vazio: a busca não devolve nada
./scripts/buscar-animais.sh

# cadastra uma ONG e 8 animais pela API de escrita do Animais:
# animal + evento no outbox → RabbitMQ → projeção do CQRS → busca pública
./scripts/seed.sh k8s

# agora a busca, pelo Ingress, devolve os animais com a distância de cada um
./scripts/buscar-animais.sh
```

## 7. Escalabilidade: Animais de 1 para 3 réplicas

```bash
# libera a carga em /mobile/v1 (os 600/min normais barrariam o teste com 429)
./scripts/rate-limit-demo.sh elevar

# mede com 1 e com 3 réplicas, sempre entrando pelo Ingress;
# mostra qual pod atendeu cada requisição (nenhum deve passar de 50%)
DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh

# volta o rate limit ao normal
./scripts/rate-limit-demo.sh restaurar
```

Para escalar à mão e mostrar os pods novos:

```bash
# sobe o Animais para 3 réplicas
kubectl scale deployment/animais -n ampara --replicas=3

# os pods novos aparecem espalhados pelos workers
kubectl get pods -n ampara -l app=animais -o wide

# volta para 2 réplicas
kubectl scale deployment/animais -n ampara --replicas=2
```

## Se algo der errado

```bash
# pods que não estão rodando (só "No resources found" = tudo certo)
kubectl get pods -n ampara --field-selector=status.phase!=Running

# últimos eventos do cluster: pod reiniciando, probe falhando, imagem faltando, escala
kubectl get events -n ampara --sort-by=.lastTimestamp | tail -15

# detalhes dos pods de um serviço, pelo label (troque animais pelo serviço com problema)
kubectl describe pod -n ampara -l app=animais

# logs de um serviço no cluster, legíveis e sem as checagens /health e /ready
./scripts/logs.sh animais

# logs de um serviço no compose
./scripts/logs.sh animais compose

# Ingress respondendo 502 por muito tempo: reinicia o controlador do Kong
kubectl rollout restart deployment -n kong
```

## Do zero (Codespace novo ou notebook): cerca de 15 min

Não faça isso na sala, porque o build demora.

```bash
# .env com senhas aleatórias e as chaves do JWT (no Codespace, já roda sozinho na criação)
./scripts/preparar-env-demo.sh

# compose, com build das imagens (cerca de 6 min)
docker compose up -d --build --wait

# kind: cluster, Kong, secrets, imagens e manifests (cerca de 8 min)
./scripts/subir-k8s.sh

# dados de demonstração nos dois ambientes
./scripts/seed.sh && ./scripts/seed.sh k8s
```
