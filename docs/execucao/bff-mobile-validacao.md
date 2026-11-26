# BFF Mobile — validação real de 25/11/2026 (#166)

Executado no Compose local completo com Docker Desktop para Windows e engine
Linux 29.9.3. As chamadas entram em `localhost:8000`, pelo Kong 3.8, sem JWT.
Os 17 containers estavam saudáveis antes da coleta. Animais, MongoDB e RabbitMQ
são reais; nenhum serviço foi substituído por mock.

| Verificação | Resultado |
| --- | --- |
| `GET /mobile/v1/animais?lat=-21.2468&lng=-44.9998&raioKm=10` sem token | 200; `X-Served-By` e `X-Animais-Served-By` presentes |
| `GET /mobile/v1/health` sem token, pelo Kong | 401 |
| Animais pausado com `docker compose pause animais` | 504 em 2.039,28 ms; corpo `codigo=servico-lento` |
| Animais restaurado com `docker compose unpause animais` | busca retorna 200 novamente |

O tempo exato, os headers e as saídas completas equivalentes a `curl -i` ficam no
[registro bruto](medicoes/bff-mobile-2026-11-25.json). A pausa é sempre revertida
em `finally`; o script não deixa Animais pausado caso uma asserção falhe.

## Imagem

`docker image inspect` mediu 263.697.655 bytes na imagem final, contra
380.852.604 bytes no target `build` com ferramentas de desenvolvimento: redução
de 30,76%. Os digests estão no registro bruto. A comparação usa o target de build
como referência com dependências de desenvolvimento, não um Dockerfile monolítico
independente. O runtime usa `node:22-alpine`, usuário `node`, dependências de
produção e JavaScript compilado.

## Erros e limites

O contrato do BFF padroniza seus erros como JSON `{codigo, mensagem}`, incluindo
401/403, validação, 404, 502 e 504. O 401 desta coleta é produzido pelo plugin JWT
do Kong e conserva o formato do gateway. Essa diferença de origem não deve ser
confundida com inconsistência entre handlers do BFF.

A jornada adicional de login, leitura/escrita de perfil, ficha, criação de pedido,
linha do tempo e cancelamento passou pelas APIs reais do gateway, com a SAGA
chegando a `AGUARDANDO_APROVACAO` e depois a `CANCELADA`. O registro fica em
[jornada-mobile-2026-11-25.json](medicoes/jornada-mobile-2026-11-25.json).
Isso não certifica as telas em aparelho físico. Notificações e RAG/recomendações
ainda dependem de #60/#67/#68; os testes de adaptação e fallback do Assistente
usam upstream simulado.

## Reproduzir

```bash
docker compose up -d --build --wait
docker build --target build -t ampara/bff-mobile:medicao-build bff/mobile
python scripts/validar-bff-mobile-compose.py
./scripts/seed.sh
python scripts/validar-jornada-mobile.py
```

Use somente o ambiente de demonstração: a jornada cria e cancela um pedido para
Thor. O seed precisa de `SEED_SENHA_DEMO` no `.env`; tokens e senhas não aparecem
nos registros.
