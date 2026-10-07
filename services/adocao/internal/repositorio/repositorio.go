// Package repositorio persiste as transições da SAGA. Ele não decide nada: carrega o
// retrato da solicitação, chama saga.Transicao e grava o resultado (estado, passos,
// histórico e outbox) numa transação só, com a linha da solicitação travada.
package repositorio

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

var (
	// ErrSolicitacaoAtiva: já existe solicitação ativa do adotante para o animal (409).
	ErrSolicitacaoAtiva = errors.New("já existe uma solicitação ativa para este animal")
	// ErrNaoEncontrada: a solicitação não existe (404).
	ErrNaoEncontrada = errors.New("solicitação não encontrada")
)

type Config struct {
	TimeoutPasso time.Duration // ADOCAO_TIMEOUT_PASSO
	PrazoDecisao time.Duration // ADOCAO_PRAZO_EXPIRACAO
	MaxReenvios  int           // ADOCAO_MAX_REENVIOS_COMPENSACAO
	Agora        func() time.Time
}

type Repositorio struct {
	pool *pgxpool.Pool
	cfg  Config
}

func Novo(pool *pgxpool.Pool, cfg Config) *Repositorio {
	if cfg.Agora == nil {
		cfg.Agora = time.Now
	}
	return &Repositorio{pool: pool, cfg: cfg}
}

// NovaSolicitacao é o que o POST /v1/solicitacoes informa.
type NovaSolicitacao struct {
	ID            string
	AdotanteID    string
	AnimalID      string
	CorrelationID string
}

func (r *Repositorio) regras() saga.Regras {
	return saga.Regras{Agora: r.cfg.Agora().UTC(), PrazoDecisao: r.cfg.PrazoDecisao, MaxReenvios: r.cfg.MaxReenvios}
}

// Criar grava a solicitação e o primeiro comando (transição 1) na mesma transação.
func (r *Repositorio) Criar(ctx context.Context, n NovaSolicitacao) (saga.Solicitacao, error) {
	vazia := saga.Solicitacao{ID: n.ID, AdotanteID: n.AdotanteID, AnimalID: n.AnimalID}
	saida, err := saga.Transicao(vazia, saga.Evento{Tipo: saga.EvSolicitacaoCriada}, r.regras())
	if err != nil {
		return saga.Solicitacao{}, err
	}

	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO solicitacoes (id, adotante_id, animal_id, estado, correlation_id)
			VALUES ($1, $2, $3, $4, $5)`, n.ID, n.AdotanteID, n.AnimalID, saida.Solicitacao.Estado, n.CorrelationID)
		if violaUnicidade(err, "solicitacoes_ativa_unica") {
			return ErrSolicitacaoAtiva
		}
		if err != nil {
			return fmt.Errorf("inserir solicitação: %w", err)
		}
		return r.persistir(ctx, tx, vazia, saga.Evento{Tipo: saga.EvSolicitacaoCriada}, saida, n.CorrelationID)
	})
	return saida.Solicitacao, err
}

// Aplicar aplica um evento à solicitação: SELECT ... FOR UPDATE, Transicao e gravação.
// O lock serializa aprovação, expiração, cancelamento e respostas da mesma solicitação.
func (r *Repositorio) Aplicar(ctx context.Context, sagaID string, ev saga.Evento) (saga.Saida, error) {
	var saida saga.Saida
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		antes, correlationID, err := carregar(ctx, tx, sagaID)
		if err != nil {
			return err
		}
		saida, err = saga.Transicao(antes, ev, r.regras())
		if err != nil {
			return err
		}
		if saida.Ignorada {
			return nil
		}
		return r.persistir(ctx, tx, antes, ev, saida, correlationID)
	})
	return saida, err
}

// AplicarResposta processa uma resposta de participante: grava o messageId na inbox e
// aplica a transição na MESMA transação. Se a inbox já tinha o messageId, a resposta é
// repetida (reentrega do broker) e nada é aplicado: duplicada volta true.
func (r *Repositorio) AplicarResposta(ctx context.Context, messageID, tipo, sagaID string, ev saga.Evento) (saida saga.Saida, duplicada bool, err error) {
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO inbox (message_id, tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING`, messageID, tipo)
		if err != nil {
			return fmt.Errorf("gravar inbox: %w", err)
		}
		if tag.RowsAffected() == 0 {
			duplicada = true
			return nil
		}
		antes, correlationID, err := carregar(ctx, tx, sagaID)
		if err != nil {
			return err
		}
		saida, err = saga.Transicao(antes, ev, r.regras())
		if err != nil {
			return err
		}
		if saida.Ignorada {
			return nil // a inbox fica gravada: a mesma mensagem não será reavaliada
		}
		return r.persistir(ctx, tx, antes, ev, saida, correlationID)
	})
	return saida, duplicada, err
}

func carregar(ctx context.Context, tx pgx.Tx, id string) (saga.Solicitacao, string, error) {
	var (
		s                                      saga.Solicitacao
		estado                                 string
		animalNome, responsavel, desfecho, mot *string
		campos                                 []byte
		correlationID                          *string
	)
	err := tx.QueryRow(ctx, `SELECT id, adotante_id, animal_id, animal_nome, responsavel_id, estado, desfecho,
			motivo, campos_faltando, expira_em, requer_intervencao, correlation_id
		FROM solicitacoes WHERE id = $1 FOR UPDATE`, id).
		Scan(&s.ID, &s.AdotanteID, &s.AnimalID, &animalNome, &responsavel, &estado, &desfecho,
			&mot, &campos, &s.ExpiraEm, &s.RequerIntervencao, &correlationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, "", ErrNaoEncontrada
	}
	if err != nil {
		return s, "", fmt.Errorf("carregar solicitação: %w", err)
	}
	s.Estado = saga.Estado(estado)
	s.AnimalNome, s.ResponsavelID, s.Motivo = valor(animalNome), valor(responsavel), valor(mot)
	s.Desfecho = saga.Estado(valor(desfecho))
	if len(campos) > 0 {
		_ = json.Unmarshal(campos, &s.CamposFaltando)
	}

	rows, err := tx.Query(ctx, `SELECT passo, status, bloqueante, tentativas FROM saga_passos WHERE saga_id = $1`, id)
	if err != nil {
		return s, "", fmt.Errorf("carregar passos: %w", err)
	}
	defer rows.Close()
	s.Passos = map[saga.Passo]saga.InfoPasso{}
	for rows.Next() {
		var passo, status string
		var info saga.InfoPasso
		if err := rows.Scan(&passo, &status, &info.Bloqueante, &info.Tentativas); err != nil {
			return s, "", err
		}
		info.Status = saga.StatusPasso(status)
		s.Passos[saga.Passo(passo)] = info
	}
	return s, valor(correlationID), rows.Err()
}

func (r *Repositorio) persistir(ctx context.Context, tx pgx.Tx, antes saga.Solicitacao, ev saga.Evento, saida saga.Saida, correlationID string) error {
	agora := r.cfg.Agora().UTC()
	s := saida.Solicitacao

	var campos []byte
	if len(s.CamposFaltando) > 0 {
		campos, _ = json.Marshal(s.CamposFaltando)
	}
	if _, err := tx.Exec(ctx, `UPDATE solicitacoes SET estado = $2, desfecho = $3, motivo = $4, campos_faltando = $5,
			animal_nome = $6, responsavel_id = $7, expira_em = $8, requer_intervencao = $9,
			versao = versao + 1, atualizado_em = $10
		WHERE id = $1`,
		s.ID, s.Estado, nulo(string(s.Desfecho)), nulo(s.Motivo), campos,
		nulo(s.AnimalNome), nulo(s.ResponsavelID), s.ExpiraEm, s.RequerIntervencao, agora); err != nil {
		return fmt.Errorf("atualizar solicitação: %w", err)
	}

	for _, alt := range saida.Passos {
		if err := r.alterarPasso(ctx, tx, s.ID, alt, agora); err != nil {
			return err
		}
	}

	for _, m := range saida.Mensagens {
		env := envelope(m, s.ID, correlationID, agora)
		corpo, _ := json.Marshal(env)
		if err := inserirOutbox(ctx, tx, s.ID, env.MessageID, m.Tipo, m.Exchange, m.RoutingKey, corpo); err != nil {
			return err
		}
		if m.Passo == "" {
			continue
		}
		comando, _ := json.Marshal(comandoGravado{Tipo: m.Tipo, Exchange: m.Exchange, RoutingKey: m.RoutingKey, Envelope: corpo})
		var prazo *time.Time
		if acompanhado(m) {
			p := agora.Add(r.cfg.TimeoutPasso)
			prazo = &p
		}
		if _, err := tx.Exec(ctx, `INSERT INTO saga_passos (saga_id, passo, message_id, comando, status, bloqueante, tentativas, prazo, atualizado_em)
				VALUES ($1, $2, $3, $4, 'PENDENTE', $5, 0, $6, $7)
				ON CONFLICT (saga_id, passo) DO UPDATE SET message_id = $3, comando = $4, status = 'PENDENTE',
					bloqueante = $5, tentativas = 0, prazo = $6, atualizado_em = $7`,
			s.ID, m.Passo, env.MessageID, comando, m.Bloqueante, prazo, agora); err != nil {
			return fmt.Errorf("abrir passo %s: %w", m.Passo, err)
		}
	}

	_, err := tx.Exec(ctx, `INSERT INTO saga_historico (saga_id, de, para, evento, passo, transicao, em)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		s.ID, nulo(string(antes.Estado)), s.Estado, string(ev.Tipo), nulo(string(passoDoEvento(ev))), saida.Transicao, agora)
	if err != nil {
		return fmt.Errorf("gravar histórico: %w", err)
	}
	return nil
}

func (r *Repositorio) alterarPasso(ctx context.Context, tx pgx.Tx, sagaID string, alt saga.AlteracaoPasso, agora time.Time) error {
	var sql string
	args := []any{sagaID, alt.Passo, agora}
	switch alt.Acao {
	case saga.Concluir:
		sql = `UPDATE saga_passos SET status = 'CONCLUIDO', prazo = NULL, atualizado_em = $3 WHERE saga_id = $1 AND passo = $2`
	case saga.Expirar:
		sql = `UPDATE saga_passos SET status = 'EXPIRADO', prazo = NULL, atualizado_em = $3 WHERE saga_id = $1 AND passo = $2`
	case saga.Esgotar:
		sql = `UPDATE saga_passos SET status = 'ESGOTADO', prazo = NULL, atualizado_em = $3 WHERE saga_id = $1 AND passo = $2`
	case saga.Reenviar, saga.Reemitir:
		// mesmo comando e mesmo messageId: a inbox do participante devolve a resposta gravada
		var tentativas int
		var comando []byte
		var messageID string
		if err := tx.QueryRow(ctx, `SELECT tentativas, comando, message_id FROM saga_passos WHERE saga_id = $1 AND passo = $2`,
			sagaID, alt.Passo).Scan(&tentativas, &comando, &messageID); err != nil {
			return fmt.Errorf("ler passo %s: %w", alt.Passo, err)
		}
		var c comandoGravado
		if err := json.Unmarshal(comando, &c); err != nil {
			return err
		}
		if err := inserirOutbox(ctx, tx, sagaID, messageID, c.Tipo, c.Exchange, c.RoutingKey, c.Envelope); err != nil {
			return err
		}
		if alt.Acao == saga.Reemitir {
			return nil
		}
		sql = `UPDATE saga_passos SET tentativas = tentativas + 1, prazo = $4, atualizado_em = $3 WHERE saga_id = $1 AND passo = $2`
		args = append(args, agora.Add(r.backoff(tentativas)))
	default:
		return fmt.Errorf("ação de passo desconhecida: %s", alt.Acao)
	}
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return fmt.Errorf("alterar passo %s: %w", alt.Passo, err)
	}
	return nil
}

// backoff exponencial a partir do timeout do passo, até 5 minutos entre tentativas.
func (r *Repositorio) backoff(tentativas int) time.Duration {
	d := r.cfg.TimeoutPasso
	for i := 0; i < tentativas && d < 5*time.Minute; i++ {
		d *= 2
	}
	return min(d, 5*time.Minute)
}

// acompanhado: o verificador de timeouts vigia os passos principais e as compensações
// bloqueantes. As precautórias não são vigiadas nem reenviadas.
func acompanhado(m saga.Mensagem) bool {
	switch m.Passo {
	case saga.T1, saga.T2, saga.T4, saga.T5:
		return true
	}
	return m.Bloqueante
}

func passoDoEvento(ev saga.Evento) saga.Passo {
	if ev.Tipo == saga.EvTimeout {
		return ev.Passo
	}
	return map[saga.TipoEvento]saga.Passo{
		saga.EvAnimalReservado: saga.T1, saga.EvReservaRecusada: saga.T1,
		saga.EvPerfilValidado: saga.T2, saga.EvPerfilRecusado: saga.T2,
		saga.EvAdocaoConfirmada: saga.T4, saga.EvConfirmacaoRecusada: saga.T4,
		saga.EvAdocaoRegistrada: saga.T5, saga.EvReservaLiberada: saga.C1, saga.EvVagaLiberada: saga.C2,
	}[ev.Tipo]
}

// Envelope padrão do catálogo (docs/contratos/eventos.md, seção 2).
type Envelope struct {
	MessageID     string         `json:"messageId"`
	Type          string         `json:"type"`
	Version       int            `json:"version"`
	CorrelationID string         `json:"correlationId"`
	SagaID        string         `json:"sagaId"`
	OccurredAt    string         `json:"occurredAt"`
	Payload       map[string]any `json:"payload"`
}

type comandoGravado struct {
	Tipo       string          `json:"tipo"`
	Exchange   string          `json:"exchange"`
	RoutingKey string          `json:"routingKey"`
	Envelope   json.RawMessage `json:"envelope"`
}

func envelope(m saga.Mensagem, sagaID, correlationID string, agora time.Time) Envelope {
	if correlationID == "" {
		correlationID = sagaID
	}
	return Envelope{
		MessageID: NovoUUID(), Type: m.Tipo, Version: 1, CorrelationID: correlationID,
		SagaID: sagaID, OccurredAt: agora.Format(time.RFC3339Nano), Payload: m.Payload,
	}
}

func inserirOutbox(ctx context.Context, tx pgx.Tx, sagaID, messageID, tipo, exchange, rk string, corpo []byte) error {
	_, err := tx.Exec(ctx, `INSERT INTO outbox (message_id, saga_id, tipo, exchange, routing_key, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
		messageID, sagaID, tipo, exchange, rk, corpo)
	if err != nil {
		return fmt.Errorf("gravar outbox: %w", err)
	}
	return nil
}

func violaUnicidade(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

func valor(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// NovoUUID gera um UUID v4.
func NovoUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
