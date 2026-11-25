# Scripts

Utilitários de desenvolvimento e demonstração. Previstos:

| Script | Para quê | Issue |
| --- | --- | --- |
| `preparar-demo.py` | cria `.env` com credenciais aleatórias e JWT, sem sobrescrever configuração existente | #73 |
| `gerar-chaves-jwt.sh` | gera o par de chaves RS256 local | #37 |
| `k8s-prep.sh` | cria os Secrets do cluster a partir do `secret.env` | #48 |
| `preparar-env-demo.sh` | gera um `.env` de demonstração com senhas aleatórias e as chaves do JWT; não sobrescreve um `.env` existente | — |
| `subir-k8s.sh` | sobe o cluster kind do zero: cluster, Kong Ingress Controller, `secret.env`, imagens e manifests | — |
| `seed.sh` | dados de demonstração: as contas da demo na Identidade (ONG, protetor, admin e adotante com perfil completo, ids fixos, senha `SEED_SENHA_DEMO` do `.env`) e oito animais da ONG, pela API de escrita do Animais (`./scripts/seed.sh` no compose, `./scripts/seed.sh k8s` no cluster) | #71 |
| `rate-limit-demo.sh` | eleva e restaura o rate limit de `/mobile/v1` em volta do `escala-demo.sh` | #51 |
| `escala-demo.sh` | mede 1 × 3 réplicas do Animais pelo Ingress; `--rate-limit-test` mostra o 429 de `/mobile/v1` com o limite normal | #51 |
| `validar-hey.sh` | lê só a seção `Status code distribution` do `hey` (usado pelo `escala-demo.sh`; teste em `tests/test-validar-hey.sh`) | #51 |
| `buscar-animais.sh` | busca pública de animais em tabela, pelo Ingress (8000) ou pelo gateway do compose (`8080`) | #71 |
| `logs.sh` | logs de um serviço em formato legível (hora, nível, mensagem, rota e status), no cluster ou no compose, sem as checagens `/health` e `/ready` | — |
| `seed/` | dados de demonstração (ONGs, animais e adotantes) | #71 |
| `demo/` | provoca cada cenário da SAGA ao vivo; `demo/participantes_falsos.py` faz o papel de Animais e da Identidade enquanto os serviços reais não existem | #71 |
| `carga/` | teste de carga da demonstração de escalabilidade | #51 |
| `reconstruir_projecao.py` | reconstrói o read model de Animais do zero | #56 |
| `dlq.sh` | lista, reprocessa e descarta mensagens das DLQs pela API do RabbitMQ (roteiro em `docs/operacao/dlq.md`) | #86 |
