DROP INDEX IF EXISTS outbox_por_message_id;
ALTER TABLE outbox ADD CONSTRAINT outbox_message_id_key UNIQUE (message_id);
DROP TABLE IF EXISTS idempotencia;
DROP TABLE IF EXISTS inbox;
DROP TABLE IF EXISTS saga_historico;
DROP TABLE IF EXISTS saga_passos;
DROP INDEX IF EXISTS solicitacoes_a_expirar;
DROP INDEX IF EXISTS solicitacoes_ativa_unica;
ALTER TABLE solicitacoes
  DROP CONSTRAINT IF EXISTS solicitacoes_estado_valido,
  DROP COLUMN IF EXISTS versao,
  DROP COLUMN IF EXISTS requer_intervencao,
  DROP COLUMN IF EXISTS expira_em,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS campos_faltando,
  DROP COLUMN IF EXISTS motivo,
  DROP COLUMN IF EXISTS desfecho,
  DROP COLUMN IF EXISTS animal_nome,
  DROP COLUMN IF EXISTS responsavel_id;
