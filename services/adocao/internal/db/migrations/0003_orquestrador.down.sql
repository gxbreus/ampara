DROP INDEX IF EXISTS historico_versao_unica;
ALTER TABLE historico DROP COLUMN IF EXISTS versao;
ALTER TABLE historico RENAME TO saga_historico;

ALTER TABLE solicitacoes
  DROP COLUMN IF EXISTS decidido_em,
  DROP COLUMN IF EXISTS decidido_por,
  DROP COLUMN IF EXISTS decisao_motivo,
  DROP COLUMN IF EXISTS decisao;

CREATE INDEX solicitacoes_a_expirar ON solicitacoes (expira_em) WHERE estado = 'AGUARDANDO_APROVACAO';
CREATE TABLE saga_passos (
  saga_id        UUID NOT NULL REFERENCES solicitacoes (id),
  passo          TEXT NOT NULL CHECK (passo IN ('T1', 'T2', 'T4', 'T5', 'C1', 'C2')),
  message_id     UUID NOT NULL,
  comando        JSONB NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('PENDENTE', 'CONCLUIDO', 'EXPIRADO', 'ESGOTADO')),
  bloqueante     BOOLEAN NOT NULL DEFAULT false,
  tentativas     INTEGER NOT NULL DEFAULT 0,
  prazo          TIMESTAMPTZ,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, passo)
);
CREATE INDEX saga_passos_vencendo ON saga_passos (prazo) WHERE status = 'PENDENTE' AND prazo IS NOT NULL;
