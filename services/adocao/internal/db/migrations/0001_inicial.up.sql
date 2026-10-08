-- Esqueleto (#40): só o essencial. A SAGA completa (#58) acrescenta as colunas e tabelas
-- restantes. O desenho do outbox e da inbox está em docs/dados.md, seção 5.

CREATE TABLE solicitacoes (
  id             UUID PRIMARY KEY,               -- igual ao sagaId
  adotante_id    UUID NOT NULL,
  animal_id      TEXT NOT NULL,                  -- ObjectId do animal em Animais
  estado         TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  message_id    UUID NOT NULL UNIQUE,
  saga_id       UUID NOT NULL,
  tipo          TEXT NOT NULL,
  exchange      TEXT NOT NULL,
  routing_key   TEXT NOT NULL,
  payload       JSONB NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_em  TIMESTAMPTZ
);
CREATE INDEX outbox_pendentes ON outbox (id) WHERE publicado_em IS NULL;
