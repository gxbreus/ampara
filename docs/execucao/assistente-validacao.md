# Validação do Assistente — #42

Em 24/11/2026, o [GitHub Actions](https://github.com/gxbreus/ampara/actions/runs/45451316660) executou 11 testes em Python 3.12, incluindo o ensaio com Docker Compose, Qdrant e Redis reais. Ruff e os checks da CI passaram.

| Cenário | Resultado |
| --- | --- |
| Qdrant e Redis disponíveis, chave do LLM vazia | GET /health e GET /ready retornaram 200 |
| Chave do LLM inválida | O serviço foi recriado e GET /health e GET /ready voltaram a responder 200 |
| Persistência do Qdrant | A coleção teste continuou disponível após o reinício |
| Rastreabilidade e usuário do contêiner | X-Served-By, X-Correlation-Id, log JSON com correlationId e UID diferente de zero |

A imagem multi-stage mediu 105.753.175 bytes e a single-stage mediu 105.754.467 bytes no mesmo runner e com as mesmas dependências. O estágio builder prepara as dependências do LangChain e do Qdrant num ambiente isolado, de modo que ferramentas de compilação, quando necessárias, fiquem fora da imagem final. As dependências usadas nesta medição vieram em wheels, o que explica a diferença pequena.

Reprodução na raiz do repositório com Docker Compose v2 e Bash.

```bash
bash scripts/validar-container-python.sh assistente
```

O ensaio cria um projeto isolado com um arquivo de ambiente temporário e remove seus contêineres e volumes ao final. O Redis armazena apenas cache. O Qdrant guarda as coleções em volume próprio.
