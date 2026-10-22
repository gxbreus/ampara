// Package repositorio guarda a solicitação de adoção como o usuário a vê (ADR-008).
//
// A SAGA é do Orquestrador. A Adoção grava a solicitação e as ações das pessoas e as
// entrega ao Orquestrador pelo outbox (solicitacao.criada, solicitacao.decidida e
// solicitacao.retomada). O estado, a linha do tempo e o prazo chegam de volta em
// saga.transicao e ficam num espelho, que é o que a API mostra.
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
	// ErrEstadoNaoPermite: a ação não é válida no estado atual (409).
	ErrEstadoNaoPermite = errors.New("o estado atual não permite a ação")
)

// Mensagens que a Adoção publica para o Orquestrador (docs/contratos/eventos.md).
const (
	TipoCriada   = "solicitacao.criada"
	TipoDecidida = "solicitacao.decidida"
	TipoRetomada = "solicitacao.retomada"
	exEventos    = "ampara.eventos"
)

type Config struct {
	Agora func() time.Time
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

// Criar grava a solicitação em SOLICITADA e o solicitacao.criada na mesma transação. O
// Orquestrador começa a SAGA ao receber a mensagem.
func (r *Repositorio) Criar(ctx context.Context, n NovaSolicitacao) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		return r.inserir(ctx, tx, n)
	})
}

func (r *Repositorio) inserir(ctx context.Context, tx pgx.Tx, n NovaSolicitacao) error {
	_, err := tx.Exec(ctx, `INSERT INTO solicitacoes (id, adotante_id, animal_id, estado, correlation_id)
		VALUES ($1, $2, $3, $4, $5)`, n.ID, n.AdotanteID, n.AnimalID, saga.Solicitada, n.CorrelationID)
	if violaUnicidade(err, "solicitacoes_ativa_unica") {
		return ErrSolicitacaoAtiva
	}
	if err != nil {
		return fmt.Errorf("inserir solicitação: %w", err)
	}
	return r.publicar(ctx, tx, TipoCriada, n.ID, n.CorrelationID, map[string]any{
		"solicitacaoId": n.ID, "adotanteId": n.AdotanteID, "animalId": n.AnimalID,
	})
}

// CriarIdempotente cria a solicitação respeitando o Idempotency-Key do POST: a mesma
// chave do mesmo adotante devolve a solicitação já criada (existente = true), sem abrir
// outra SAGA. Sem chave, é um Criar comum.
func (r *Repositorio) CriarIdempotente(ctx context.Context, n NovaSolicitacao, chave string) (id string, existente bool, err error) {
	if chave == "" {
		return n.ID, false, r.Criar(ctx, n)
	}
	if id, ok, err := r.porChave(ctx, n.AdotanteID, chave); err != nil || ok {
		return id, ok, err
	}
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if err := r.inserir(ctx, tx, n); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO idempotencia (adotante_id, chave, solicitacao_id) VALUES ($1, $2, $3)`,
			n.AdotanteID, chave, n.ID)
		return err
	})
	// duas requisições com a mesma chave ao mesmo tempo: a segunda perde no PRIMARY KEY
	// da idempotencia (ou no índice de ativa) e devolve a solicitação da primeira
	if violaUnicidade(err, "idempotencia_pkey") || errors.Is(err, ErrSolicitacaoAtiva) {
		if id, ok, e := r.porChave(ctx, n.AdotanteID, chave); e == nil && ok {
			return id, true, nil
		}
	}
	return n.ID, false, err
}

func (r *Repositorio) porChave(ctx context.Context, adotanteID, chave string) (string, bool, error) {
	var id string
	err := r.pool.QueryRow(ctx, `SELECT solicitacao_id FROM idempotencia WHERE adotante_id = $1 AND chave = $2`, adotanteID, chave).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// Visao é a solicitação como a API a representa (docs/contratos/adocao.v1.yaml).
type Visao struct {
	ID                string
	Estado            saga.Estado
	Desfecho          saga.Estado
	Motivo            string
	AnimalID          string
	AnimalNome        string
	AdotanteID        string
	ResponsavelID     string
	ExpiraEm          *time.Time
	RequerIntervencao bool
	// Decisao registrada e já entregue ao Orquestrador; o estado muda quando o
	// saga.transicao voltar. Vazia enquanto ninguém decidiu.
	Decisao      saga.Decisao
	CriadoEm     time.Time
	AtualizadoEm time.Time
}

// Obter lê a solicitação para a API.
func (r *Repositorio) Obter(ctx context.Context, id string) (Visao, error) {
	v, err := lerVisao(r.pool.QueryRow(ctx, `SELECT `+colunasVisao+` FROM solicitacoes WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return v, ErrNaoEncontrada
	}
	return v, err
}

// Decidir registra a aprovação, a recusa ou o cancelamento e publica solicitacao.decidida.
// Com a linha travada, só passa se o espelho estiver em AGUARDANDO_APROVACAO e ainda não
// houver decisão: o duplo clique, ou aprovar e cancelar ao mesmo tempo, recebe 409. Se o
// prazo vencer no mesmo instante, quem resolve a corrida é o Orquestrador.
func (r *Repositorio) Decidir(ctx context.Context, id string, d saga.Decisao, motivo, por string) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var estado string
		var decisao, correlationID *string
		err := tx.QueryRow(ctx, `SELECT estado, decisao, correlation_id FROM solicitacoes WHERE id = $1 FOR UPDATE`, id).
			Scan(&estado, &decisao, &correlationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNaoEncontrada
		}
		if err != nil {
			return fmt.Errorf("carregar solicitação: %w", err)
		}
		if saga.Estado(estado) != saga.AguardandoAprovacao || decisao != nil {
			return ErrEstadoNaoPermite
		}
		if _, err := tx.Exec(ctx, `UPDATE solicitacoes SET decisao = $2, decisao_motivo = $3, decidido_por = $4,
				decidido_em = $5, atualizado_em = $5 WHERE id = $1`,
			id, d, nulo(motivo), por, r.cfg.Agora().UTC()); err != nil {
			return fmt.Errorf("gravar decisão: %w", err)
		}
		payload := map[string]any{"solicitacaoId": id, "decisao": string(d), "decididaPor": por, "motivo": nulo(motivo)}
		return r.publicar(ctx, tx, TipoDecidida, id, valor(correlationID), payload)
	})
}

// Retomar pede ao Orquestrador que retome os passos esgotados (#86), publicando
// solicitacao.retomada. Só vale quando o espelho indica que a SAGA espera intervenção.
func (r *Repositorio) Retomar(ctx context.Context, id, por string) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var intervencao bool
		var correlationID *string
		err := tx.QueryRow(ctx, `SELECT requer_intervencao, correlation_id FROM solicitacoes WHERE id = $1 FOR UPDATE`, id).
			Scan(&intervencao, &correlationID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNaoEncontrada
		}
		if err != nil {
			return fmt.Errorf("carregar solicitação: %w", err)
		}
		if !intervencao {
			return ErrEstadoNaoPermite
		}
		return r.publicar(ctx, tx, TipoRetomada, id, valor(correlationID), map[string]any{"solicitacaoId": id, "pedidaPor": por})
	})
}

// Transicao é o payload de saga.transicao (docs/contratos/eventos.md).
type Transicao struct {
	SolicitacaoID     string     `json:"solicitacaoId"`
	Versao            int        `json:"versao"`
	De                *string    `json:"de"`
	Estado            string     `json:"estado"`
	Desfecho          *string    `json:"desfecho"`
	Motivo            *string    `json:"motivo"`
	CamposFaltando    []string   `json:"camposFaltando"`
	AnimalNome        *string    `json:"animalNome"`
	ResponsavelID     *string    `json:"responsavelId"`
	ExpiraEm          *time.Time `json:"expiraEm"`
	RequerIntervencao bool       `json:"requerIntervencao"`
	Evento            string     `json:"evento"`
	Passo             *string    `json:"passo"`
	Transicao         int        `json:"transicao"`
	Em                time.Time  `json:"em"`
}

// AplicarTransicao atualiza o espelho e a linha do tempo com um saga.transicao. Grava o
// messageId na inbox na mesma transação: a reentrega volta duplicada sem efeito. Uma
// versão mais antiga que a do espelho (fora de ordem) não muda o estado, mas entra na linha
// do tempo, que é ordenada pela versão.
func (r *Repositorio) AplicarTransicao(ctx context.Context, messageID string, t Transicao) (duplicada bool, err error) {
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO inbox (message_id, tipo) VALUES ($1, 'saga.transicao') ON CONFLICT DO NOTHING`, messageID)
		if err != nil {
			return fmt.Errorf("gravar inbox: %w", err)
		}
		if tag.RowsAffected() == 0 {
			duplicada = true
			return nil
		}
		var existe bool
		if err := tx.QueryRow(ctx, `SELECT true FROM solicitacoes WHERE id = $1 FOR UPDATE`, t.SolicitacaoID).Scan(&existe); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNaoEncontrada
			}
			return fmt.Errorf("carregar solicitação: %w", err)
		}

		var campos []byte
		if len(t.CamposFaltando) > 0 {
			campos, _ = json.Marshal(t.CamposFaltando)
		}
		if _, err := tx.Exec(ctx, `UPDATE solicitacoes SET estado = $2, desfecho = $3, motivo = $4, campos_faltando = $5,
				animal_nome = coalesce($6, animal_nome), responsavel_id = coalesce($7, responsavel_id), expira_em = $8,
				requer_intervencao = $9, versao = $10, atualizado_em = $11
			WHERE id = $1 AND versao < $10`,
			t.SolicitacaoID, t.Estado, t.Desfecho, t.Motivo, campos, t.AnimalNome, t.ResponsavelID, t.ExpiraEm,
			t.RequerIntervencao, t.Versao, t.Em); err != nil {
			return fmt.Errorf("atualizar solicitação: %w", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO historico (saga_id, versao, de, para, evento, passo, transicao, em)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (saga_id, versao) DO NOTHING`,
			t.SolicitacaoID, t.Versao, t.De, t.Estado, t.Evento, t.Passo, t.Transicao, t.Em)
		if err != nil {
			return fmt.Errorf("gravar histórico: %w", err)
		}
		return nil
	})
	return duplicada, err
}

// publicar grava a mensagem no outbox, na transação de quem chamou.
func (r *Repositorio) publicar(ctx context.Context, tx pgx.Tx, tipo, sagaID, correlationID string, payload map[string]any) error {
	if correlationID == "" {
		correlationID = sagaID
	}
	env := Envelope{
		MessageID: NovoUUID(), Type: tipo, Version: 1, CorrelationID: correlationID,
		SagaID: sagaID, OccurredAt: r.cfg.Agora().UTC().Format(time.RFC3339Nano), Payload: payload,
	}
	corpo, _ := json.Marshal(env)
	_, err := tx.Exec(ctx, `INSERT INTO outbox (message_id, saga_id, tipo, exchange, routing_key, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
		env.MessageID, sagaID, tipo, exEventos, tipo, corpo)
	if err != nil {
		return fmt.Errorf("gravar outbox: %w", err)
	}
	return nil
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
