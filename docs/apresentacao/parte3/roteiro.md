# Gravação da Parte 3 — até 10 minutos

Referências: [requisitos RC-01 a RC-12](../../requisitos.md),
[imagens](../../imagens.md), [Kubernetes](../../../k8s/README.md).
As falas abaixo são tópicos para explicar com as próprias palavras.

## Condições para gravar

Use um ambiente de demonstração separado, `.env` preenchido e chaves geradas.
Não limpe imagens, volumes ou clusters de outros projetos. Para mostrar a subida,
pare apenas o Compose da Ampara; não use `down --volumes`, pois o próximo trecho
verifica os dados preservados. Instale Git, Docker/Compose, kind, kubectl, Helm,
curl e hey. Cada integrante grava webcam e tela com áudio inteligível.

Antes da gravação, os PRs de gateway, Ingress, Identidade, Animais e BFF Mobile
precisam estar integrados no commit demonstrado. Os scripts `teste-rotas.sh`
(#150) e `escala-demo.sh` (#152) também precisam existir nesse checkout.
Notificações/Assistente e seus manifests dependem das entregas dos donos.
Se um componente não estiver disponível, registre a lacuna e não o anuncie como funcionando.

## Ordem das cenas

| Tempo | Quem | Ação na tela | Explicação e critério |
| --- | --- | --- | --- |
| 0:00–0:35 | todos | apresentação curta dos quatro e diagrama da arquitetura | papéis e visão geral |
| 0:35–2:35 | Mateus | subir Compose, listar serviços, mostrar Dockerfiles e preservar documento | multi-stage, redes, volumes (RC-01 a RC-05) |
| 2:35–4:25 | Gabriel Soares | cluster, Kong/Ingress e comparação de rotas | entrada única e políticas equivalentes (RC-08, RC-11) |
| 4:25–6:50 | Gabriel Cantanhede | Deployments/Services e uma versus três réplicas | balanceamento, distribuição real e métricas (RC-06, RC-07, RC-10) |
| 6:50–9:15 | Gabriel Nakazato | ConfigMaps, nomes dos Secrets, recuperação de pod e dados | configuração e persistência (RC-03, RC-09) |
| 9:15–9:50 | todos | conclusão e próximos testes da Parte 4 | quatro participações técnicas (RC-12) |

Grave os comandos completos. Acelere somente esperas de build/rollout, com aviso
visível; não corte falhas para transformar um teste reprovado em aprovação.

## Mateus: Compose, imagens e persistência

```bash
docker compose up -d --build --wait
docker compose ps
docker network ls --filter label=com.docker.compose.project=ampara
docker volume ls --filter label=com.docker.compose.project=ampara
docker image ls --filter reference='ampara/*'
```

Mostre `services/adocao/Dockerfile` e uma imagem Node/Python. Compare somente
tamanhos realmente medidos na [tabela de imagens](../../imagens.md).
Explique: o runtime contém o artefato necessário; bancos têm volumes e cada
serviço só participa da própria rede de dados, além da rede de serviços.

No Mongo de demonstração, escreva uma marca antes de reiniciar:

```bash
docker compose exec -T mongo-animais sh -ec 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "db.getSiblingDB(\"animais\").teste_video.updateOne({_id:\"parte3\"},{\$set:{ok:true}},{upsert:true})"'
docker compose down
docker compose up -d --wait
docker compose exec -T mongo-animais sh -ec 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "if (!db.getSiblingDB(\"animais\").teste_video.findOne({_id:\"parte3\"})) quit(1)"'
```

Não há `--volumes`: o documento deve sobreviver ao ciclo. Caso falhe, interrompa
o ensaio e corrija o ambiente antes de gravar a versão final.

## Gabriel Soares: Kubernetes e Ingress

```bash
kind create cluster --config k8s/kind-config.yaml
./scripts/k8s-prep.sh
docker compose build
```

Carregue as imagens e instale o Kong conforme [k8s/README.md](../../../k8s/README.md)
do commit demonstrado; a configuração de Helm é entregue na #151.

```bash
kubectl apply -k k8s/
kubectl get pods -n ampara -o wide
kubectl get ingress -n ampara
```

Compose e kind usam a porta 8000 no host. Execute `scripts/teste-rotas.sh`
primeiro contra o Compose e depois contra o cluster, liberando essa porta entre
os testes e seguindo os parâmetros documentados no próprio script. Mostre 401
sem JWT em rota privada e acesso anônimo à busca; não mostre o valor do token.

## Gabriel Cantanhede: réplicas e escala

```bash
kubectl get deploy,svc -n ampara
kubectl get pods -n ampara -l app=animais -o wide
curl -si 'http://localhost:8000/mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10'
# depois de elevar temporariamente o rate limit conforme docs/escalabilidade.md:
DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh
```

Explique: Service é o endereço estável; `X-Animais-Served-By` identifica quem
atendeu no serviço Animais. Mostre as contagens de 300 respostas e req/s, p50,
p95 e erros nas duas configurações. A vazão não precisa triplicar em hardware
compartilhado; a distribuição precisa ser real. Restaure o rate limit normal.

## Gabriel Nakazato: configuração e recuperação

```bash
kubectl get configmaps,secrets -n ampara
git ls-files 'k8s/*/secret.env'
kubectl get statefulsets,pvc -n ampara
```

O segundo comando não deve listar credenciais locais. Mostre um
`secret.env.example` e o `secretGenerator`; não decodifique nem imprima Secrets.
Use um pod de serviço sem estado para mostrar reposição:

```bash
pod=$(kubectl get pod -n ampara -l app=animais -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n ampara "$pod"
kubectl rollout status deployment/animais -n ampara --timeout=180s
kubectl get pods -n ampara -l app=animais -o wide
```

Para Redis/Qdrant, mostre os volumes e a leitura do mesmo dado antes/depois de
recriar o pod, usando o procedimento do dono. Não chame existência de PVC de
prova de persistência; é preciso conferir o conteúdo. Registre os comandos
específicos usados quando esses componentes estiverem integrados.

## Ensaio, edição e entrega

| Execução | Data | Duração real | Falhas/ajustes | Responsável | Commit |
| --- | --- | --- | --- | --- | --- |
| ensaio | pendente | pendente | pendente | pendente | pendente |
| gravação final | pendente | pendente | pendente | todos | pendente |

- [ ] Os quatro aparecem e explicam tecnicamente suas partes.
- [ ] Cada critério foi mostrado funcionando, com comandos visíveis.
- [ ] Duração final medida ≤ 10:00 e áudio revisado por todos.
- [ ] Vídeo/URL e duração preenchidos no README desta pasta.
- [ ] Link incluído no README principal após existir um vídeo real.
- [ ] Cada integrante responde perguntas sobre o trecho de outro colega.

Para reduzir um MP4 com ffmpeg, quando disponível:

```bash
ffmpeg -i video.mp4 -vf scale=-2:720 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 96k video-720p.mp4
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 video-720p.mp4
```

O tempo proposto da tabela não é evidência da duração do vídeo exportado.
