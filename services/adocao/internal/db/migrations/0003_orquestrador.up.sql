-- ADR-008: a SAGA saiu para o Orquestrador. A Adoção guarda a solicitação como o usuário a
-- vê: um espelho do estado, que chega em saga.transicao, a decisão humana e a linha do tempo.

-- os passos e os prazos agora são do Orquestrador
DROP TABLE saga_passos;
DROP INDEX solicitacoes_a_expirar;

-- a decisão do responsável (ou o cancelamento do adotante), entregue ao Orquestrador em
-- solicitacao.decidida; uma por solicitação
ALTER TABLE solicitacoes
  ADD COLUMN decisao        TEXT CHECK (decisao IN ('APROVADA', 'RECUSADA', 'CANCELADA')),
  ADD COLUMN decisao_motivo TEXT,
  ADD COLUMN decidido_por   UUID,
  ADD COLUMN decidido_em    TIMESTAMPTZ;
COMMENT ON COLUMN solicitacoes.versao IS 'versão do último saga.transicao aplicado; os mais antigos são descartados';

-- a linha do tempo vem de saga.transicao; a versão ordena e evita linha repetida
ALTER TABLE saga_historico RENAME TO historico;
ALTER TABLE historico ADD COLUMN versao INTEGER;
CREATE UNIQUE INDEX historico_versao_unica ON historico (saga_id, versao);
