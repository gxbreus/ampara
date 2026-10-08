# Kubernetes

Manifests para o cluster local ([kind](https://kind.sigs.k8s.io/)), no namespace `ampara`, organizados com kustomize. Nenhuma credencial é versionada: os Secrets são gerados a partir de um `secret.env` local, que o Git ignora.

## Subir do zero

Pré-requisitos: Docker, [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) e `kubectl` (o kustomize já vem nele).

```bash
# 1. variáveis e chaves (as mesmas do docker compose)
cp .env.example .env
./scripts/gerar-chaves-jwt.sh
# preencha usuários e senhas no .env

# 2. cluster com 1 control-plane e 2 workers
kind create cluster --config k8s/kind-config.yaml

# 3. secret.env de cada componente e as chaves JWT nas pastas que precisam
./scripts/k8s-prep.sh

# 4. imagens: o kind não enxerga as imagens do Docker local, é preciso carregá-las
docker compose build
for img in rabbitmq adocao bff-web; do kind load docker-image ampara/$img:dev --name ampara; done

# 5. tudo
kubectl apply -k k8s/
kubectl get pods -n ampara -o wide -w
```

Para apagar o cluster: `kind delete cluster --name ampara`.

## Padrão de pasta

Cada componente tem a própria pasta, listada em `k8s/kustomization.yaml`:

```text
k8s/<componente>/
├── kustomization.yaml     namespace ampara, recursos e o secretGenerator
├── deployment.yaml        ou statefulset.yaml, para bancos e broker
├── service.yaml
├── configmap.yaml         configuração que não é segredo
├── secret.env.example     versionado, sem valores
└── secret.env             gerado pelo k8s-prep.sh, ignorado pelo Git
```

O Secret sai do `secretGenerator`, nunca de um YAML com `stringData`:

```yaml
secretGenerator:
  - name: adocao-secret
    envs: [secret.env]
generatorOptions:
  disableNameSuffixHash: true
```

### Como escrever o `secret.env.example`

Cada linha é uma de duas formas, e nenhuma tem valor de senha:

| Linha | O `k8s-prep.sh` grava |
| --- | --- |
| `POSTGRES_PASSWORD=` | o valor de `POSTGRES_PASSWORD` do `.env` |
| `ADOCAO_DATABASE_URL=postgres://${ADOCAO_DB_USER}:${ADOCAO_DB_PASSWORD}@postgres-adocao:5432/adocao?sslmode=disable` | o modelo com cada `${VAR}` trocado pelo valor do `.env` |

### Chaves do JWT

O `k8s-prep.sh` grava a chave **privada** só em `k8s/identidade/jwt.key`, porque só a Identidade assina tokens. A chave **pública** vai para toda pasta cujo `kustomization.yaml` cite o `jwt.pub` (gateway, BFFs e serviços que validam tokens, como a Adoção), por um `configMapGenerator`.

## Componentes

| Pasta | Recursos | Observação |
| --- | --- | --- |
| `rabbitmq/` | StatefulSet (1 réplica, PVC 1 Gi) e Service 5672/15672 | a imagem `ampara/rabbitmq:dev` já traz a topologia e cria um usuário por serviço a partir do `rabbitmq-secret` |
| `adocao/` | Deployment (2 réplicas), Service 8080, ConfigMap e StatefulSet `postgres-adocao` (PVC 1 Gi) | o pod do serviço recebe só `ADOCAO_DATABASE_URL` e `ADOCAO_AMQP_URL`; as credenciais de superusuário ficam com o banco |
| `bff-web/` | Deployment (2 réplicas), Service 3010 e ConfigMaps | a chave pública do JWT vem do `jwt.pub` gerado pelo `k8s-prep.sh` |

O BFF Web usa `/web/v1/health` também como readiness. O `/web/v1/ready` dele checa os serviços chamados: como readiness, um serviço fora do ar tiraria o BFF inteiro do balanceamento, quando o contrato prevê resposta parcial com `avisos[]` (#29).

## Regras para os manifests

- `image: ampara/<nome>:dev` com `imagePullPolicy: IfNotPresent`. Com a tag `latest`, o padrão vira `Always` e o kind tenta baixar a imagem do Docker Hub.
- Readiness em `/ready` e liveness em `/health`. A liveness nunca aponta para `/ready`: com o banco fora, o pod reiniciaria em loop.
- O `selector` do Deployment precisa bater com os `labels` do template.
- Bancos são StatefulSets com `volumeClaimTemplates` e um Service headless (`clusterIP: None`).
- No PostgreSQL, defina `PGDATA=/var/lib/postgresql/data/pgdata`: o volume do kind cria `lost+found`, e o Postgres recusa um diretório que não esteja vazio.
- Cada serviço recebe no Secret só a própria credencial, inclusive a do RabbitMQ (um usuário por serviço, #89).
