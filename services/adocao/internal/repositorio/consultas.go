package repositorio

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

// ErrCursorInvalido: o cursor não veio de uma página anterior (422).
var ErrCursorInvalido = errors.New("cursor inválido")

// Filtro da listagem GET /v1/solicitacoes. Campos vazios não filtram.
type Filtro struct {
	AdotanteID        string
	AnimalID          string
	ResponsavelID     string
	Estado            saga.Estado
	Ativa             *bool
	RequerIntervencao *bool
	Cursor            string
	Limite            int
}

var estadosAtivos = []string{"SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA", "COMPENSANDO"}

const colunasVisao = `id, estado, desfecho, motivo, animal_id, animal_nome, adotante_id, responsavel_id,
	expira_em, requer_intervencao, criado_em, atualizado_em`

// Listar devolve uma página, da mais recente para a mais antiga, e o cursor da próxima
// ("" quando não há mais). O cursor é a posição (criado_em, id) do último item.
func (r *Repositorio) Listar(ctx context.Context, f Filtro) ([]Visao, string, error) {
	var cond []string
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }

	if f.AdotanteID != "" {
		cond = append(cond, "adotante_id = "+arg(f.AdotanteID))
	}
	if f.AnimalID != "" {
		cond = append(cond, "animal_id = "+arg(f.AnimalID))
	}
	if f.ResponsavelID != "" {
		cond = append(cond, "responsavel_id = "+arg(f.ResponsavelID))
	}
	if f.Estado != "" {
		cond = append(cond, "estado = "+arg(string(f.Estado)))
	}
	if f.Ativa != nil {
		if *f.Ativa {
			cond = append(cond, "estado = ANY("+arg(estadosAtivos)+")")
		} else {
			cond = append(cond, "estado <> ALL("+arg(estadosAtivos)+")")
		}
	}
	if f.RequerIntervencao != nil {
		cond = append(cond, "requer_intervencao = "+arg(*f.RequerIntervencao))
	}
	if f.Cursor != "" {
		criado, id, err := lerCursor(f.Cursor)
		if err != nil {
			return nil, "", err
		}
		cond = append(cond, fmt.Sprintf("(criado_em, id) < (%s, %s)", arg(criado), arg(id)))
	}
	limite := f.Limite
	if limite <= 0 {
		limite = 20
	}
	sql := "SELECT " + colunasVisao + " FROM solicitacoes"
	if len(cond) > 0 {
		sql += " WHERE " + strings.Join(cond, " AND ")
	}
	sql += fmt.Sprintf(" ORDER BY criado_em DESC, id DESC LIMIT %s", arg(limite+1))

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, "", fmt.Errorf("listar solicitações: %w", err)
	}
	itens, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Visao, error) { return lerVisao(row) })
	if err != nil {
		return nil, "", err
	}
	proximo := ""
	if len(itens) > limite {
		itens = itens[:limite]
		ultimo := itens[len(itens)-1]
		proximo = escreverCursor(ultimo.CriadoEm, ultimo.ID)
	}
	return itens, proximo, nil
}

func lerVisao(row pgx.Row) (Visao, error) {
	var v Visao
	var estado string
	var desfecho, motivo, nome, responsavel *string
	err := row.Scan(&v.ID, &estado, &desfecho, &motivo, &v.AnimalID, &nome, &v.AdotanteID, &responsavel, &v.ExpiraEm,
		&v.RequerIntervencao, &v.CriadoEm, &v.AtualizadoEm)
	v.Estado, v.Desfecho = saga.Estado(estado), saga.Estado(valor(desfecho))
	v.Motivo, v.AnimalNome, v.ResponsavelID = valor(motivo), valor(nome), valor(responsavel)
	return v, err
}

func escreverCursor(criado time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(criado.UTC().Format(time.RFC3339Nano) + "|" + id))
}

func lerCursor(c string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", ErrCursorInvalido
	}
	criado, id, ok := strings.Cut(string(b), "|")
	t, err := time.Parse(time.RFC3339Nano, criado)
	if !ok || err != nil || id == "" {
		return time.Time{}, "", ErrCursorInvalido
	}
	return t, id, nil
}

// Resumo é o que o painel da ONG precisa numa chamada só (BFF Web, sem N+1).
type Resumo struct {
	PorEstado       map[string]int
	AtivasPorAnimal map[string]int
	ConcluidasNoMes int
}

// Resumir conta as solicitações de um responsável. O mês é o mês corrente em UTC.
func (r *Repositorio) Resumir(ctx context.Context, responsavelID string) (Resumo, error) {
	res := Resumo{PorEstado: map[string]int{}, AtivasPorAnimal: map[string]int{}}
	rows, err := r.pool.Query(ctx, `SELECT estado, count(*) FROM solicitacoes WHERE responsavel_id = $1 GROUP BY estado`, responsavelID)
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var e string
		var n int
		if err := rows.Scan(&e, &n); err != nil {
			rows.Close()
			return res, err
		}
		res.PorEstado[e] = n
	}
	rows.Close()

	rows, err = r.pool.Query(ctx, `SELECT animal_id, count(*) FROM solicitacoes
		WHERE responsavel_id = $1 AND estado = ANY($2) GROUP BY animal_id`, responsavelID, estadosAtivos)
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var a string
		var n int
		if err := rows.Scan(&a, &n); err != nil {
			rows.Close()
			return res, err
		}
		res.AtivasPorAnimal[a] = n
	}
	rows.Close()

	inicioMes := time.Date(r.cfg.Agora().UTC().Year(), r.cfg.Agora().UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	err = r.pool.QueryRow(ctx, `SELECT count(*) FROM solicitacoes
		WHERE responsavel_id = $1 AND estado = 'CONCLUIDA' AND atualizado_em >= $2`, responsavelID, inicioMes).Scan(&res.ConcluidasNoMes)
	return res, err
}

// ItemHistorico é uma linha da linha do tempo (HU-14).
type ItemHistorico struct {
	De     string
	Para   string
	Evento string
	Passo  string
	Em     time.Time
}

// Historico devolve todas as transições da solicitação, em ordem.
func (r *Repositorio) Historico(ctx context.Context, id string) ([]ItemHistorico, error) {
	rows, err := r.pool.Query(ctx, `SELECT coalesce(de, ''), para, evento, coalesce(passo, ''), em
		FROM saga_historico WHERE saga_id = $1 ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ItemHistorico, error) {
		var i ItemHistorico
		err := row.Scan(&i.De, &i.Para, &i.Evento, &i.Passo, &i.Em)
		return i, err
	})
}
