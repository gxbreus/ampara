# Kubernetes

Manifests para o cluster local (kind), no namespace `ampara`. Uma pasta por componente, cada uma com Deployment, Service, ConfigMap e o template do Secret:

```text
k8s/
├── base/            namespace, Secrets (gerados por scripts/k8s-prep.sh, fora do Git)
├── gateway/         Kong Ingress Controller e Ingress
├── identidade/      + postgres-identidade
├── animais/         + mongo-animais
├── adocao/          + postgres-adocao
├── notificacoes/    + redis-notificacoes
├── assistente/      + qdrant-assistente e redis-assistente
├── bff-web/
├── bff-mobile/
└── rabbitmq/
```

Nenhuma credencial é versionada: os Secrets vêm de um `secret.env` local, ignorado pelo Git.

**Issues:** #46, #47, #48, #49 (manifests), #50 (Ingress), #51 (escalabilidade)
