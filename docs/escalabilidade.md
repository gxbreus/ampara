# Demonstração de escalabilidade

Este registro compara uma e três réplicas do serviço Animais. O tráfego entra
exclusivamente no Ingress Kong em `localhost:8000`; nenhuma medição por
`port-forward` para um pod é válida para este requisito.

## Antes de medir

1. Suba o cluster completo, com Ingress, BFF Mobile e Animais saudáveis.
2. Eleve temporariamente o rate limit de `/mobile/v1`. O KongPlugin
   `rate-limit-mobile` (`k8s/kong/plugins.yaml`) fica em `minute: 600`, e a
   carga de 20 segundos com o `hey` gera milhares de requisições por minuto,
   além das 300 da amostra: com o limite normal, quase tudo voltaria `429` e a
   medição seria inválida. O `scripts/rate-limit-demo.sh` sobe o limite para
   1.000.000/min e depois o devolve aos 600/min:

   ```bash
   ./scripts/rate-limit-demo.sh elevar
   # o mesmo que:
   # kubectl patch kongplugin rate-limit-mobile -n ampara --type merge -p '{"config":{"minute":1000000}}'
   ```

   Confira o valor em vigor com
   `kubectl get kongplugin rate-limit-mobile -n ampara -o jsonpath='{.config.minute}'`.
3. Garanta que o BFF Mobile devolve `X-Animais-Served-By` para a busca.
4. Instale `hey` e execute:

   ```bash
   DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh
   ```

5. Restaure o limite normal, inclusive se a carga falhar:

   ```bash
   ./scripts/rate-limit-demo.sh restaurar
   ```

O script interrompe se a URL não for `localhost:8000`, se o header estiver
ausente ou se o limite temporário não tiver sido aplicado.

## Passo opcional: mostrar o 429

Separado da medição, e com o limite normal já restaurado (600/min), o script
dispara 1.200 requisições pelo Ingress e exige que parte delas volte `429`:

```bash
./scripts/rate-limit-demo.sh restaurar
./scripts/escala-demo.sh --rate-limit-test
```

Ele se recusa a rodar se o `rate-limit-mobile` ainda estiver elevado. Não
participa das medições de vazão; se a máquina não gerar 600 requisições dentro
da janela de um minuto, o `429` não aparece e o teste falha, o que deve ser
registrado como tal.

## Registro da execução

Preencha após a execução real. Não substitua os campos por valores estimados.
O script confere HTTP 200 e o header de réplica em cada uma das 300 chamadas,
exige as três réplicas na distribuição sem concentração acima de 50%, e reprova
erros HTTP/rede no `hey`, analisando somente a seção `Status code distribution:`.
O histograma de latência não é interpretado como código HTTP (a análise fica em
`scripts/validar-hey.sh`, coberto por `scripts/tests/test-validar-hey.sh`). Na
fase de três réplicas, o script reprova se os pods não estiverem em pelo menos
dois nós. Depois de cada `rollout status`, sonda a busca por até ~30 s até que
respondam exatamente os pods esperados, porque o Service e o Kong levam alguns
segundos para atualizar os endpoints. Ao sair, restaura o número original de réplicas.
Guarde a saída completa com `DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh | tee escala.txt`.
O indicador de rate limit é uma confirmação do operador: o script não altera nem
atesta a configuração do Kong. Restaure o limite normal depois da demonstração.

Registre CPU/RAM durante cada fase com `kubectl top pods -n ampara -l app=animais`
e `kubectl top nodes`. Esses comandos precisam de metrics-server; se não estiver
instalado, registre essa ausência e use medições reais do runtime, identificando
a ferramenta. Não deduza utilização a partir de requests/limits dos manifests.

| Data | Máquina (CPU / RAM) | Kubernetes | Kong | `hey` |
| --- | --- | --- | --- | --- |
| 17/11/2026 | AMD Ryzen 7 5700U with Radeon Graphics, 16 threads / 9 GB | kind v0.25.0, Kubernetes v1.31.2 (1 control-plane + 2 workers) | Kong Ingress Controller, `kong:3.9` | `williamyeh/hey` (Docker) |

| Réplicas | Req/s | p50 | p95 | Taxa de erro | Distribuição de 300 requisições |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 248,0 | 78,4 ms | 104,5 ms | 0% (4.976 respostas 200) | 300 em `animais-…-mt6sb` |
| 3 | 558,0 | 32,9 ms | 69,3 ms | 0% (11.182 respostas 200) | 111 / 100 / 89 (máximo de 37%), pods em `ampara-worker` e `ampara-worker2` |

## Interpretação

Em um notebook, as três réplicas podem dividir a mesma CPU e a vazão não precisa
triplicar. A evidência deste requisito é a distribuição: com três réplicas, cada
pod deve atender parte relevante das 300 requisições e nenhum deve concentrar mais
de 50% delas. O `kubectl get pods -o wide` da execução deve mostrar os pods em pelo
menos dois workers.

### Keep-alive e balanceamento

Na primeira execução, com 3 réplicas, só 2 pods receberam tráfego (150 / 150). O Service do
Kubernetes balanceia por **conexão**, e o `fetch` do BFF Mobile reaproveitava conexões
keep-alive: cada pod do BFF ficava preso a um pod do Animais, e a réplica nova não recebia
nada. A correção (`bff/mobile/src/cliente.ts`) usa um `Agent` do undici sem keep-alive nas
chamadas internas. Cada chamada abre uma conexão nova e passa de novo pelo balanceamento do
Service, ao custo de um handshake TCP dentro do cluster.
