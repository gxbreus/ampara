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
O script confere HTTP 200 e o header de réplica em cada uma das 300 chamadas,
exige as três réplicas na distribuição sem concentração acima de 50%, e reprova
erros HTTP/rede no `hey`. Ao sair, restaura o número original de réplicas.
Guarde a saída completa com `DEMO_RATE_LIMIT_ELEVATED=true ./scripts/escala-demo.sh | tee escala.txt`.
O indicador de rate limit é uma confirmação do operador: o script não altera nem
atesta a configuração do Kong. Restaure o limite normal depois da demonstração.

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
