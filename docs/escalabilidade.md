# Demonstração de escalabilidade

Este registro compara uma e três réplicas do serviço Animais. O tráfego entra
exclusivamente no Ingress Kong em `localhost:8000`; nenhuma medição por
`port-forward` para um pod é válida para este requisito.

## Antes de medir

1. Suba o cluster completo, com Ingress, BFF Mobile e Animais saudáveis.
2. Aplique temporariamente a configuração de demonstração que eleva o limite
   de `/mobile/v1` acima de 300 requisições. Em seguida, restaure os 600/min
   normais e mostre o `429` em uma chamada separada.
3. Garanta que o BFF Mobile devolve `X-Animais-Served-By` para a busca.
4. Instale `hey` e execute:

   ```bash
   DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh
   ```

O script interrompe se a URL não for `localhost:8000`, se o header estiver
ausente ou se o limite temporário não tiver sido aplicado.

## Registro da execução

Preencha após a execução real. Não substitua os campos por valores estimados.

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
