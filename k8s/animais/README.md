# Animais e MongoDB no cluster

Use `scripts/k8s-prep.sh` na raiz depois de configurar `.env` e gerar o par JWT.
Ele cria `secret.env` e `jwt.pub`, ignorados pelo Git. Os nomes dos databases vêm
das URLs secretas; os campos de ConfigMap documentam as coleções do serviço.

Carregue as imagens e aplique os manifests conforme `k8s/README.md`.
O Mongo inicia rs0 pela startup probe; `publishNotReadyAddresses` permite resolver
o Service antes de o banco eleger o primário. A readiness exige um primário
gravável. O keyFile e os documentos ficam no PVC, preservado ao recriar o pod.

Verificação no cluster:

```bash
kubectl rollout status deployment/animais -n ampara --timeout=180s
kubectl rollout status deployment/bff-mobile -n ampara --timeout=180s
kubectl get pods -n ampara -o wide -l app=animais
kubectl exec -n ampara mongo-animais-0 -- sh -ec 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "if (rs.status().ok !== 1) quit(1); printjson(rs.conf().members)"'
kubectl scale deployment/animais -n ampara --replicas=3
kubectl rollout status deployment/animais -n ampara --timeout=180s
kubectl get pods -n ampara -o wide -l app=animais
```

No banco de demonstração, teste o volume:

```bash
kubectl exec -n ampara mongo-animais-0 -- sh -ec 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "db.getSiblingDB(\"animais\").teste_pvc.updateOne({_id:\"persistencia\"},{\$set:{ok:true}},{upsert:true})"'
kubectl delete pod mongo-animais-0 -n ampara
kubectl rollout status statefulset/mongo-animais -n ampara --timeout=180s
kubectl exec -n ampara mongo-animais-0 -- sh -ec 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --eval "if (!db.getSiblingDB(\"animais\").teste_pvc.findOne({_id:\"persistencia\"})) quit(1)"'
kubectl scale deployment/animais -n ampara --replicas=2
```

O BFF usa `/health` como readiness para manter a resposta parcial se Identidade,
Notificações ou Assistente estiverem fora. `/ready` fica disponível para diagnóstico
dos cinco upstreams; é a mesma decisão do BFF Web.

Validação local: YAMLs analisados e referências de portas/imagens conferidas.
Não há cluster/Docker nesta máquina: rollout, persistência, distribuição entre
workers e escala continuam pendentes de execução real. Registre saídas e data no PR.

Validação adicional em 17/11/2026: o k8s-prep.sh foi executado numa cópia isolada
com credenciais geradas para teste. kubectl kustomize renderizou 32 objetos; foram
conferidas as referências a ConfigMaps/Secrets e as duas réplicas dos Deployments.
Esse teste não acessa cluster e não comprova rollout, persistência ou escala real.
