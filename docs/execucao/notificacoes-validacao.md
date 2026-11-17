# Validação parcial de Notificações — #41

Registro de 2026-11-17. Branch `feature/notificacoes-esqueleto`, baseada em
`develop` a7b3264. Implementa conexões no lifespan com fechamento em falha
parcial, configuração secreta, readiness Redis/RabbitMQ e rastreabilidade JSON.

## Executado

Windows, Python 3.13.13 disponível localmente (a imagem e a CI usam 3.12).
Depois de instalar `services/notificacoes/requirements-dev.txt` em `.venv`,
na pasta `services/notificacoes`:

```powershell
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\ruff.exe check .
..\..\.venv\Scripts\ruff.exe format --check .
```

Resultado: **8 testes passaram**, lint e formato aprovados. Um aviso de
depreciação de Starlette/AnyIO no TestClient. Redis e RabbitMQ foram **mocks**:
os testes cobrem queda, reconexão ainda em curso, liveness independente,
headers, log JSON e fechamento de recursos na saída e em inicialização parcial.
Não há evidência de consumo de eventos nesta issue; pertence à #60.

## Pendências concretas

- PR #168 aberto: Dockerfiles, serviço no Compose e tamanhos anteriores já
  existem nessa branch compartilhada. Não foram copiados nem modificados aqui.
  Integrar após seu merge em develop e medir novamente com estas dependências.
- #23 tem contrato preparado em branch própria, ainda sem publicação/merge.
- Docker instalado, mas engine Linux indisponível (pipe
  `dockerDesktopLinuxEngine` inexistente). Não executados build, health real,
  readiness com dependências reais e persistência após restart.
- O Compose em develop já contém Redis com senha, AOF e volume; não publica
  porta. `appendfsync everysec` é o padrão do Redis, mantido pelo comando atual.
- Git local sem autenticação de escrita e conector GitHub com erro 403:
  push/PR pendentes. Usar `Refs #41`, sem fechar a issue antes das evidências.

Depois dos pré-requisitos, executar na raiz (Bash):

```bash
docker compose up -d --build notificacoes
docker compose exec -T notificacoes python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8002/ready').status)"
docker compose exec -T redis-notificacoes redis-cli SET teste 1
docker compose restart redis-notificacoes
docker compose exec -T redis-notificacoes redis-cli GET teste
docker compose stop redis-notificacoes
# /ready deve responder 503 e /health deve continuar 200
docker compose start redis-notificacoes
docker compose stop rabbitmq
# /ready deve responder 503 durante a reconexão
docker compose start rabbitmq
```

O container Redis já recebe REDISCLI_AUTH pelo Compose. Aguardar saúde entre
os passos, confirmar recuperação do /ready e remover a chave de teste ao fim.
Registrar saídas reais no PR, sem senhas nem URLs com credenciais.
