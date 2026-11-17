# Validação parcial de Assistente — #42

Registro de 2026-11-17. Branch `feature/assistente-esqueleto`, baseada em
`develop` a7b3264. Conexões async no lifespan com fechamento reverso: Qdrant,
Redis dedicado e HTTP de Animais. Nenhum cliente LLM é criado na inicialização.
Configuração inclui os nomes existentes do `.env.example`, com chave vazia
permitida. Health não consulta dependências; ready consulta só Qdrant e Redis.

## Executado

Windows, Python 3.13.13 disponível (a imagem e a CI usam 3.12). Instalação de
`services/assistente/requirements-dev.txt` em `.venv`. Na pasta do serviço:

```powershell
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\ruff.exe check .
..\..\.venv\Scripts\ruff.exe format --check .
```

**10 testes passaram**, lint e formato aprovados. Um aviso de depreciação de
Starlette/AnyIO no TestClient. Testes com **mocks** para Qdrant e Redis: falhas
individuais produzem 503, liveness permanece 200, chave vazia/inválida não
impede lifespan nem readiness, conexões são fechadas e logs/headers carregam
correlationId. Não foi feita chamada ao provedor nem inferência real.

`langchain-qdrant==1.0.0` permite `qdrant-client==1.12.2`, alinhado ao servidor
`qdrant/qdrant:v1.12.6` já presente no Compose; versões posteriores do adaptador
exigem cliente mais novo. Metadados oficiais do PyPI consultados em 2026-11-17.
LangChain 1.x e adaptador Groq estão fixados em requirements.txt.

## Pendências concretas

- PR #168 aberto contém Dockerfile e serviço Compose; não duplicar essa entrega.
- #35 tem ADR em branch própria, pendente de publicação e merge.
- Docker Linux engine desligado: não foram executados build, readiness real,
  queda de dependências reais, persistência do Qdrant nem medição da imagem.
- Os tamanhos do PR #168 são anteriores às novas dependências; não reutilizá-los
  como medição desta branch em `docs/imagens.md`. Medir builder/runtime após merge.
- Push e PR pendentes de autenticação Git ou permissão de escrita no conector.
  Usar `Refs #42` até completar a validação real; não fechar a issue.

Depois do merge dos pré-requisitos, na raiz (Bash):

```bash
LLM_API_KEY= docker compose up -d --build assistente
docker compose exec -T assistente python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8003/ready').status)"
docker compose exec -T assistente python -c "import asyncio; from qdrant_client import AsyncQdrantClient, models; c=AsyncQdrantClient(url='http://qdrant-assistente:6333'); asyncio.run(c.create_collection('prova_persistencia_42', vectors_config=models.VectorParams(size=3, distance=models.Distance.COSINE)))"
docker compose restart qdrant-assistente
docker compose exec -T assistente python -c "import asyncio; from qdrant_client import AsyncQdrantClient; c=AsyncQdrantClient(url='http://qdrant-assistente:6333'); print(asyncio.run(c.get_collection('prova_persistencia_42')))"
docker image inspect ampara/assistente:dev --format '{{.Size}}'
```

Usar ambiente de demo, aguardar ready entre comandos e remover somente a
coleção de teste ao fim. Repetir readiness com chave inválida e após parar e
recuperar cada banco. Registrar saídas reais e o tamanho em bytes no PR.
