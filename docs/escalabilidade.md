# Demonstração de escalabilidade

Este registro compara uma e três réplicas do serviço Animais. O tráfego entra
exclusivamente no Ingress Kong em `localhost:8000`; nenhuma medição por
`port-forward` para um pod é válida para este requisito.

## Antes de medir

1. Suba o cluster completo, com Ingress, BFF Mobile e Animais saudáveis.
2. Em cluster de demo, eleve temporariamente o limite de `/mobile/v1` para
   100000/min: a carga de 20 segundos gera milhares de requisições, além das
   300 da amostra. Se ainda houver 429, a medição é inválida. Restaure a
   configuração original ao sair. Para o padrão 600/min do PR #151:

   ```bash
   kubectl patch kongplugin rate-limit-mobile -n ampara --type merge -p '{"config":{"minute":100000}}'
   # Após a carga, inclusive se ela falhar:
   kubectl patch kongplugin rate-limit-mobile -n ampara --type merge -p '{"config":{"minute":600}}'
   ```

   Confira primeiro o valor atual com `kubectl get kongplugin rate-limit-mobile
   -n ampara -o jsonpath='{.config.minute}'`; se não for 600, restaure esse valor.
   Espere a configuração propagar antes de cada fase. Com o limite normal,
   execute separadamente `bash scripts/escala-demo.sh --rate-limit-test` para
   comprovar 429. Este teste não participa das medições de vazão e pode falhar
   se a máquina não gerar tráfego suficiente dentro da janela: registre a falha.
3. Garanta que o BFF Mobile devolve `X-Animais-Served-By` para a busca.
4. Instale `hey` e execute:

   ```bash
   DEMO_RATE_LIMIT_ELEVATED=true bash scripts/escala-demo.sh
   ```

O script interrompe se a URL não for `localhost:8000`, se o header estiver
ausente ou se o limite temporário não tiver sido aplicado.

## Registro da execução

Preencha após a execução real. Não substitua os campos por valores estimados.
O script confere HTTP 200 e o header de réplica em cada uma das 300 chamadas,
exige as três réplicas na distribuição sem concentração acima de 50%, e reprova
erros HTTP/rede no `hey`, analisando somente a seção `Status code distribution:`.
O histograma de latência não é interpretado como código HTTP. O script verifica
também pelo menos dois nós na fase de três réplicas e espera a propagação dos
endpoints. Ao sair, restaura o número original de réplicas.
Guarde a saída completa com `DEMO_RATE_LIMIT_ELEVATED=true bash scripts/escala-demo.sh | tee escala.txt`.
O indicador de rate limit é uma confirmação do operador: o script não altera nem
atesta a configuração do Kong. Restaure o limite normal depois da demonstração.

Registre CPU/RAM durante cada fase com `kubectl top pods -n ampara -l app=animais`
e `kubectl top nodes`. Esses comandos precisam de metrics-server; se não estiver
instalado, registre essa ausência e use medições reais do runtime, identificando
a ferramenta. Não deduza utilização a partir de requests/limits dos manifests.

Validação local em 2026-11-17: sintaxe Bash e regressão do parser com saídas
simuladas, inclusive bucket `[412]` com HTTP 200, HTTP 429, rede com erro e
ausência da seção de status. Cluster/hey indisponíveis; nenhuma medição real.

| Data | Máquina (CPU / RAM) | Kubernetes | Kong | `hey` |
| --- | --- | --- | --- | --- |
| _pendente_ | _pendente_ | _pendente_ | _pendente_ | _pendente_ |

| Réplicas | Req/s | p50 | p95 | Taxa de erro | Distribuição de 300 requisições |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | _pendente_ | _pendente_ | _pendente_ | _pendente_ | _pendente_ |
| 3 | _pendente_ | _pendente_ | _pendente_ | _pendente_ | _pendente_ |

## Interpretação

Em um notebook, as três réplicas podem dividir a mesma CPU e a vazão não precisa
triplicar. A evidência deste requisito é a distribuição: com três réplicas, cada
pod deve atender parte relevante das 300 requisições e nenhum deve concentrar mais
de 50% delas. O `kubectl get pods -o wide` da execução deve mostrar os pods em pelo
menos dois workers.
