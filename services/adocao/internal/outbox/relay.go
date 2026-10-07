// Package outbox publica as mensagens gravadas na tabela outbox. É o ÚNICO lugar do
// serviço que publica no RabbitMQ: comando e evento só existem depois de gravados na mesma
// transação da mudança de estado (docs/dados.md, seção 5).
package outbox

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Mensagem é uma linha pendente do outbox.
type Mensagem struct {
	ID            int64
	MessageID     string
	SagaID        string
	Tipo          string
	Exchange      string
	RoutingKey    string
	CorrelationID string
	Corpo         []byte
}

// Publicador entrega a mensagem ao broker e só retorna sem erro depois do publisher confirm.
type Publicador interface {
	Publicar(ctx context.Context, m Mensagem) error
}

type Relay struct {
	pool      *pgxpool.Pool
	pub       Publicador
	log       *slog.Logger
	Intervalo time.Duration
	Lote      int
}

func NovoRelay(pool *pgxpool.Pool, pub Publicador, log *slog.Logger) *Relay {
	return &Relay{pool: pool, pub: pub, log: log, Intervalo: 200 * time.Millisecond, Lote: 100}
}

// Rodar publica o outbox a cada Intervalo até o contexto acabar.
func (r *Relay) Rodar(ctx context.Context) {
	t := time.NewTicker(r.Intervalo)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := r.Ciclo(ctx); err != nil && ctx.Err() == nil {
				r.log.Warn("relay do outbox", "erro", err.Error())
			}
		}
	}
}

// Ciclo publica um lote. Com FOR UPDATE SKIP LOCKED, duas réplicas pegam linhas
// diferentes e nenhuma linha é publicada em dobro ao mesmo tempo. Uma linha só é marcada
// depois do confirm; se o processo cair entre publicar e marcar, ela sai de novo com o
// mesmo messageId, e a inbox do consumidor descarta a repetida.
func (r *Relay) Ciclo(ctx context.Context) (int, error) {
	publicadas := 0
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, message_id, saga_id, tipo, exchange, routing_key,
				coalesce(payload->>'correlationId', ''), payload
			FROM outbox WHERE publicado_em IS NULL
			ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, r.Lote)
		if err != nil {
			return err
		}
		lote, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Mensagem, error) {
			var m Mensagem
			err := row.Scan(&m.ID, &m.MessageID, &m.SagaID, &m.Tipo, &m.Exchange, &m.RoutingKey, &m.CorrelationID, &m.Corpo)
			return m, err
		})
		if err != nil {
			return err
		}

		var confirmadas []int64
		var erroPub error
		for _, m := range lote {
			if erroPub = r.pub.Publicar(ctx, m); erroPub != nil {
				break // as seguintes ficam para o próximo ciclo, na mesma ordem
			}
			confirmadas = append(confirmadas, m.ID)
			r.log.Info("mensagem publicada", "sagaId", m.SagaID, "messageId", m.MessageID, "tipo", m.Tipo,
				"correlationId", m.CorrelationID)
		}
		if len(confirmadas) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE outbox SET publicado_em = now() WHERE id = ANY($1)`, confirmadas); err != nil {
				return err
			}
		}
		publicadas = len(confirmadas)
		if erroPub != nil {
			r.log.Warn("publicação falhou; o restante fica pendente", "erro", erroPub.Error(), "publicadas", publicadas)
		}
		return nil
	})
	return publicadas, err
}
