# ADR 004: CQRS no serviço de Animais

- Status: aceita
- Data: 2026-10-09
- Autores: Gabriel Cantanhede
- Revisor: Mateus Vitor

## Contexto

O serviço de Animais concentra duas cargas de trabalho com perfis totalmente assimétricos:

1. **Escrita (Commands):** Executada por protetores e ONGs via App Web para cadastrar, editar e atualizar status de animais. Possui baixo volume de requisições, mas exige dados detalhados e sensíveis: endereço residencial completo, coordenadas GPS exatas, histórico médico e histórico de transições de status.
2. **Leitura (Queries):** Executada continuamente por adotantes no App Mobile e pelo serviço Assistente. Possui alto volume de requisições concorrentes e exige consultas geoespaciais por raio de distância (`$geoNear`).

Além da discrepância de volume, existem dois requisitos conflitantes:
- **Privacidade (LGPD):** A busca pública nunca pode expor endereços ou coordenadas exatas de residências e abrigos.
- **Desnormalização sem acoplamento temporal:** Cada card de busca precisa informar se a ONG é verificada (`responsavel.nome` e `responsavel.verificado`), dado que pertence ao serviço de Identidade. Realizar chamadas síncronas à Identidade para cada card em uma lista de busca degradaria a latência e criaria dependência direta de disponibilidade.

## Decisão

1. **Adotar CQRS (Command Query Responsibility Segregation) no serviço de Animais.**
2. **Modelo de Escrita:**
   - Reside no database `animais`, coleção `animais`.
   - Contém o documento completo normalizado, coordenadas exatas em GeoJSON e auditoria de status.
   - Toda alteração incrementa o campo `version` e insere o evento de domínio (`animal.criado`, `animal.atualizado`, `animal.status_alterado`) na coleção `animais.outbox` na mesma transação atômica do MongoDB.
3. **Modelo de Leitura:**
   - Reside no database `animais_leitura`, coleção `animais_busca`.
   - Contém dados desnormalizados, miniaturas de fotos (`fotoThumb`), coordenadas anonimizadas em grade de ~500 m (`pontoAproximado`) com índice `2dsphere`, e dados da ONG embutidos.
   - Armazena documentos em todos os status: a rota `GET /v1/animais/busca` filtra apenas `DISPONIVEL`, enquanto o detalhe `GET /v1/animais/busca/{id}` permite consultar a ficha pública em qualquer status.
4. **Isolamento de Databases na mesma instância MongoDB no MVP:**
   - No MVP, ambos os databases (`animais` e `animais_leitura`) residem na mesma instância de banco `mongo-animais` configurada em replica set `rs0`.
   - O serviço conecta-se por meio de **duas variáveis de ambiente distintas**: `ANIMAIS_MONGO_URL` e `ANIMAIS_LEITURA_MONGO_URL`. Isso garante que desacoplar a leitura para uma instância física separada seja uma simples mudança de configuração, sem alteração de código.
5. **Atualização Assíncrona e Idempotência:**
   - O relay de outbox publica eventos no exchange `ampara.eventos` do RabbitMQ.
   - Um worker de projeção escuta a fila `animais.projecao` e atualiza `animais_busca` via upsert idempotente validando `version > version_atual`.
   - Eventos `conta.verificada` da Identidade atualizam a projeção sem qualquer chamada HTTP síncrona.
6. **Defasagem tolerada:**
   - A consistência eventual aceita tem SLA de $p95 \le 5\text{ s}$, mensurável por meio do campo `atualizadoEm` retornado nas respostas de busca.

Os detalhes completos de modelagem, fluxo e scripts de reconstrução estão em [`docs/cqrs.md`](../cqrs.md).

## Alternativas consideradas

### 1. Coleção única com índices (sem CQRS)
Manter apenas a coleção `animais` e executar a busca geográfica diretamente sobre ela.
- **Problemas:** Para atender à LGPD, o serviço precisaria filtrar e anonimizar as coordenadas em memória a cada leitura, desperdiçando CPU; para exibir o nome da ONG, precisaria fazer *joins* ou chamadas HTTP à Identidade; e o alto tráfego de buscas disputaria recursos com as transações de escrita e outbox.
- **Decisão:** Rejeitada.

### 2. Segunda instância de banco dedicada (outro cluster MongoDB ou Elasticsearch)
Separar a leitura em um cluster físico independente ou em um motor de busca especializado (Elasticsearch).
- **Problemas:** Aumentaria drasticamente a complexidade operacional e o consumo de memória RAM do cluster local no ambiente acadêmico (que já executa 2 PostgreSQL, MongoDB, Redis, Qdrant e RabbitMQ). O MongoDB já possui suporte nativo maduro e eficiente a índices geoespaciais `2dsphere`.
- **Decisão:** Rejeitada para o MVP. O uso de databases distintos com URLs independentes permite essa migração futura de forma transparente.

### 3. CQRS no serviço de Adoção
Criar projeções para o painel de solicitações do serviço de Adoção.
- **Problemas:** Adoção é um processo transacional centrado em máquina de estados da SAGA, com volume de leitura compatível com consultas indexadas relacionais no PostgreSQL.
- **Decisão:** Rejeitada para o MVP, mantida como estudo pós-MVP (#77).

| Critério | CQRS com 2 databases (Escolhida) | Coleção única (Sem CQRS) | Instância dedicada / Elasticsearch |
| :--- | :---: | :---: | :---: |
| **Isolamento de modelos** | Alto | Inexistente | Alto |
| **Proteção LGPD** | Nativa no dado projetado | Em memória a cada query | Nativa no índice |
| **Custo de infraestrutura local** | Mínimo (mesmo container) | Mínimo | Alto (novo container pesado) |
| **Prontidão para escalar** | Alta (URLs separadas) | Baixa | Alta |
| **Consistência** | Eventual ($p95 \le 5\text{ s}$) | Forte | Eventual |

## Consequências

- **Positivas:**
  - Consultas de busca extremamente rápidas, ordenadas por distância geoespacial via índice `2dsphere`.
  - Dados sensíveis e coordenadas residenciais protegidos por design (Privacy by Design).
  - Resiliência: se o broker ou o projetor caírem temporariamente, a busca continua funcionando normalmente com o estado atual do read model.
  - Zero chamadas síncronas à Identidade para montar as telas de busca do mobile.
- **Negativas / Desafios:**
  - Consistência eventual: animais recém-cadastrados ou com status alterado demoram de 1 a 2 segundos para refletir na busca.
  - Exige manutenção do worker projetor e testes rigorosos de idempotência para mensagens fora de ordem.
  - Exige procedimento e script de reconstrução (*rebuild*) do read model para cenários de recuperação de desastres.
