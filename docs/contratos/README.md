# Contratos de API e eventos

Esta pasta contém os contratos OpenAPI de cada microsserviço e os esquemas dos
payloads publicados no RabbitMQ.

Os 30 schemas em `mensagens/` são a versão extraída e normalizada das fichas em
`eventos.md`; o catálogo continua sendo a fonte de verdade. Para regenerá-los
após editar uma ficha, rode:

```bash
node scripts/extrair-schemas-mensagens.mjs
```

Para conferir que os schemas não divergiram do catálogo, que cada exemplo é
válido e que os OpenAPI continuam válidos, instale as dependências do
validador e rode:

```bash
npm ci --prefix bff/web
bash scripts/validar-contratos.sh
```

Cada nova rota deverá incluir:

- método e caminho;
- parâmetros e corpo da requisição;
- respostas de sucesso e erro;
- autenticação exigida;
- exemplos de uso.

Cada evento deverá incluir nome, versão, produtor, consumidores e esquema da mensagem.
