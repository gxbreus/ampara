-- Modelo completo do orquestrador da SAGA (#58). Desenho em docs/saga.md e docs/dados.md.

ALTER TABLE solicitacoes
  ADD COLUMN responsavel_id     UUID,                     -- vem de AnimalReservado
  ADD COLUMN animal_nome        TEXT,                     -- cópia vinda de AnimalReservado
  ADD COLUMN desfecho           TEXT,                     -- estado final que virá, em COMPENSANDO
  ADD COLUMN motivo             TEXT,
  ADD COLUMN campos_faltando    JSONB,
  ADD COLUMN correlation_id     TEXT,
  ADD COLUMN expira_em          TIMESTAMPTZ,              -- gravado ao entrar em AGUARDANDO_APROVACAO
  ADD COLUMN requer_intervencao BOOLEAN NOT NULL DEFAULT false,  -- compensação esgotada (#86)
  ADD COLUMN versao             INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT solicitacoes_estado_valido CHECK (estado IN (
    'SOLICITADA', 'ANIMAL_RESERVADO', 'AGUARDANDO_APROVACAO', 'APROVADA', 'COMPENSANDO',
    'CONCLUIDA', 'REJEITADA_INDISPONIVEL', 'PERFIL_INVALIDO', 'RECUSADA', 'CANCELADA', 'EXPIRADA', 'FALHOU'));

-- no máximo uma solicitação ativa do mesmo adotante para o mesmo animal (409 no POST)
CREATE UNIQUE INDEX solicitacoes_ativa_unica ON solicitacoes (adotante_id, animal_id)
  WHERE estado IN ('SOLICITADA', 'ANIMAL_RESERVADO', 'AGUARDANDO_APROVACAO', 'APROVADA', 'COMPENSANDO');
-- o verificador de expiração busca por aqui
CREATE INDEX solicitacoes_a_expirar ON solicitacoes (expira_em) WHERE estado = 'AGUARDANDO_APROVACAO';

-- Um passo por linha: o comando enviado fica gravado, e todo reenvio usa o mesmo message_id,
-- para a inbox do participante devolver a resposta já gravada.
CREATE TABLE saga_passos (
  saga_id        UUID NOT NULL REFERENCES solicitacoes (id),
  passo          TEXT NOT NULL CHECK (passo IN ('T1', 'T2', 'T4', 'T5', 'C1', 'C2')),
  message_id     UUID NOT NULL,
  comando        JSONB NOT NULL,                          -- exchange, routing key e envelope
  status         TEXT NOT NULL CHECK (status IN ('PENDENTE', 'CONCLUIDO', 'EXPIRADO', 'ESGOTADO')),
  bloqueante     BOOLEAN NOT NULL DEFAULT false,
  tentativas     INTEGER NOT NULL DEFAULT 0,              -- reenvios feitos
  prazo          TIMESTAMPTZ,                             -- null: não é acompanhado (precautória)
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, passo)
);
CREATE INDEX saga_passos_vencendo ON saga_passos (prazo) WHERE status = 'PENDENTE' AND prazo IS NOT NULL;

-- linha do tempo (HU-14) e GET /v1/solicitacoes/{id}/historico
CREATE TABLE saga_historico (
  id         BIGSERIAL PRIMARY KEY,
  saga_id    UUID NOT NULL REFERENCES solicitacoes (id),
  de         TEXT,
  para       TEXT NOT NULL,
  evento     TEXT NOT NULL,
  passo      TEXT,
  transicao  SMALLINT NOT NULL,
  em         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX saga_historico_por_saga ON saga_historico (saga_id, id);

-- respostas já processadas: a mesma mensagem reentregue vira ack sem efeito
CREATE TABLE inbox (
  message_id     UUID PRIMARY KEY,
  tipo           TEXT NOT NULL,
  processada_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency-Key do POST /v1/solicitacoes
CREATE TABLE idempotencia (
  adotante_id     UUID NOT NULL,
  chave           TEXT NOT NULL,
  solicitacao_id  UUID NOT NULL REFERENCES solicitacoes (id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (adotante_id, chave)
);

-- um reenvio por timeout grava outra linha com o mesmo message_id
ALTER TABLE outbox DROP CONSTRAINT outbox_message_id_key;
CREATE INDEX outbox_por_message_id ON outbox (message_id);
