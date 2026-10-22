-- Modelo do Orquestrador da SAGA de adoção (ADR-008). Saiu da Adoção, que fica só com a
-- solicitação vista pelo usuário. Desenho em docs/saga.md e docs/dados.md.

-- Uma linha por SAGA. O id é o da solicitação na Adoção (o sagaId das mensagens).
CREATE TABLE sagas (
  id                 UUID PRIMARY KEY,
  adotante_id        UUID NOT NULL,
  animal_id          TEXT NOT NULL,                    -- ObjectId do animal em Animais
  animal_nome        TEXT,                             -- cópia vinda de AnimalReservado
  responsavel_id     UUID,                             -- vem de AnimalReservado
  estado             TEXT NOT NULL CHECK (estado IN (
    'SOLICITADA', 'ANIMAL_RESERVADO', 'AGUARDANDO_APROVACAO', 'APROVADA', 'COMPENSANDO',
    'CONCLUIDA', 'REJEITADA_INDISPONIVEL', 'PERFIL_INVALIDO', 'RECUSADA', 'CANCELADA', 'EXPIRADA', 'FALHOU')),
  desfecho           TEXT,                             -- estado final que virá, em COMPENSANDO
  motivo             TEXT,
  campos_faltando    JSONB,
  correlation_id     TEXT,
  expira_em          TIMESTAMPTZ,                      -- gravado ao entrar em AGUARDANDO_APROVACAO
  requer_intervencao BOOLEAN NOT NULL DEFAULT false,   -- passo esgotado (#86)
  versao             INTEGER NOT NULL DEFAULT 0,       -- sobe a cada transição; vai em saga.transicao
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- o verificador de expiração busca por aqui
CREATE INDEX sagas_a_expirar ON sagas (expira_em) WHERE estado = 'AGUARDANDO_APROVACAO';

-- Um passo por linha: o comando enviado fica gravado, e todo reenvio usa o mesmo message_id,
-- para a inbox do participante devolver a resposta já gravada.
CREATE TABLE saga_passos (
  saga_id        UUID NOT NULL REFERENCES sagas (id),
  passo          TEXT NOT NULL CHECK (passo IN ('T1', 'T2', 'T4', 'T5', 'C1', 'C2')),
  message_id     UUID NOT NULL,
  comando        JSONB NOT NULL,                       -- exchange, routing key e envelope
  status         TEXT NOT NULL CHECK (status IN ('PENDENTE', 'CONCLUIDO', 'EXPIRADO', 'ESGOTADO')),
  bloqueante     BOOLEAN NOT NULL DEFAULT false,
  tentativas     INTEGER NOT NULL DEFAULT 0,           -- reenvios feitos
  prazo          TIMESTAMPTZ,                          -- null: não é acompanhado (precautória)
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, passo)
);
CREATE INDEX saga_passos_vencendo ON saga_passos (prazo) WHERE status = 'PENDENTE' AND prazo IS NOT NULL;

-- Auditoria de cada transição. A linha do tempo que o usuário vê fica na Adoção, montada
-- a partir de saga.transicao.
CREATE TABLE saga_historico (
  id         BIGSERIAL PRIMARY KEY,
  saga_id    UUID NOT NULL REFERENCES sagas (id),
  versao     INTEGER NOT NULL,
  de         TEXT,
  para       TEXT NOT NULL,
  evento     TEXT NOT NULL,
  passo      TEXT,
  transicao  SMALLINT NOT NULL,
  em         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX saga_historico_por_saga ON saga_historico (saga_id, id);

-- mensagens já processadas (respostas e solicitacao.*): a reentrega vira ack sem efeito
CREATE TABLE inbox (
  message_id     UUID PRIMARY KEY,
  tipo           TEXT NOT NULL,
  processada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um reenvio por timeout grava outra linha com o mesmo message_id, por isso não é UNIQUE.
CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  message_id    UUID NOT NULL,
  saga_id       UUID NOT NULL,
  tipo          TEXT NOT NULL,
  exchange      TEXT NOT NULL,
  routing_key   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_em  TIMESTAMPTZ
);
CREATE INDEX outbox_pendentes ON outbox (id) WHERE publicado_em IS NULL;
CREATE INDEX outbox_por_message_id ON outbox (message_id);
