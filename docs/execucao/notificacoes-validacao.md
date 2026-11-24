# Validação de Notificações — #41

Em 24/11/2026, o [GitHub Actions](https://github.com/gxbreus/ampara/actions/runs/45451238696) executou 9 testes em Python 3.12, incluindo o ensaio com Docker Compose, Redis e RabbitMQ reais. Ruff e os checks da CI passaram.

| Cenário | Resultado |
| --- | --- |
| Redis e RabbitMQ disponíveis | GET /health e GET /ready retornaram 200 |
| Redis parado | GET /ready retornou 503 e GET /health continuou em 200 |
| RabbitMQ parado | GET /ready retornou 503 e GET /health continuou em 200 |
| Dependências recuperadas | GET /ready voltou a retornar 200 |
| Persistência do Redis com AOF | SET teste 1, reinício e GET teste retornando 1 |
| Redis sem autenticação | PING retornou NOAUTH. O Redis não tem porta publicada e usa appendfsync everysec |
| Rastreabilidade e usuário do contêiner | X-Served-By, X-Correlation-Id, log JSON com correlationId e UID diferente de zero |

A imagem multi-stage mediu 57.848.359 bytes e a single-stage mediu 57.849.099 bytes no mesmo runner e com as mesmas dependências.

Reprodução na raiz do repositório com Docker Compose v2 e Bash.

```bash
bash scripts/validar-container-python.sh notificacoes
```

O ensaio cria um projeto isolado com um arquivo de ambiente temporário e remove seus contêineres e volumes ao final. O consumo de eventos pertence à #60.
