// Package prazos vigia os prazos da SAGA: o timeout de cada passo (ADOCAO_TIMEOUT_PASSO)
// e o prazo da decisão humana (ADOCAO_PRAZO_EXPIRACAO). Como todo estado está no banco,
// ele também é a retomada depois de um reinício: o que travou com o serviço fora do ar
// vence o prazo e é tratado aqui.
package prazos

import (
	"context"
	"log/slog"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

// Repositorio é a parte do repositório que o verificador usa.
type Repositorio interface {
	PassosVencidos(ctx context.Context, limite int) ([]repositorio.Vencido, error)
	AplicarTimeout(ctx context.Context, sagaID string, passo saga.Passo) (saga.Saida, error)
	MessageID(ctx context.Context, sagaID string, passo saga.Passo) string
	AExpirar(ctx context.Context, limite int) ([]string, error)
	Aplicar(ctx context.Context, sagaID string, ev saga.Evento) (saga.Saida, error)
}

// NivelCritico é o nível CRITICAL dos logs (acima de ERROR); o main o imprime com esse nome.
const NivelCritico = slog.Level(12)

type Verificador struct {
	repo      Repositorio
	log       *slog.Logger
	Intervalo time.Duration
	Lote      int
}

func Novo(repo Repositorio, log *slog.Logger) *Verificador {
	return &Verificador{repo: repo, log: log, Intervalo: time.Second, Lote: 50}
}

func (v *Verificador) Rodar(ctx context.Context) {
	t := time.NewTicker(v.Intervalo)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			v.Ciclo(ctx)
		}
	}
}

// Ciclo trata os passos vencidos e as solicitações a expirar. Devolve quantas transições
// aplicou.
func (v *Verificador) Ciclo(ctx context.Context) int {
	aplicadas := 0
	vencidos, err := v.repo.PassosVencidos(ctx, v.Lote)
	if err != nil {
		v.log.Warn("listar passos vencidos", "erro", err.Error())
	}
	for _, p := range vencidos {
		saida, err := v.repo.AplicarTimeout(ctx, p.SagaID, p.Passo)
		if err != nil {
			v.log.Error("aplicar timeout", "sagaId", p.SagaID, "passo", p.Passo, "erro", err.Error())
			continue
		}
		if saida.Ignorada {
			continue // outra réplica tratou primeiro
		}
		aplicadas++
		if saida.Solicitacao.RequerIntervencao {
			// teto de reenvios atingido: a SAGA parou e espera um ADMIN (#86)
			v.log.Log(ctx, NivelCritico, "passo esgotado: a solicitação requer intervenção", "sagaId", p.SagaID, "passo", p.Passo,
				"messageId", v.repo.MessageID(ctx, p.SagaID, p.Passo), "estado", saida.Solicitacao.Estado)
			continue
		}
		v.log.Warn("timeout de passo", "sagaId", p.SagaID, "passo", p.Passo,
			"transicao", saida.Transicao, "estado", saida.Solicitacao.Estado)
	}

	ids, err := v.repo.AExpirar(ctx, v.Lote)
	if err != nil {
		v.log.Warn("listar solicitações a expirar", "erro", err.Error())
	}
	for _, id := range ids {
		saida, err := v.repo.Aplicar(ctx, id, saga.Evento{Tipo: saga.EvPrazoExpirado})
		if err != nil {
			v.log.Error("expirar solicitação", "sagaId", id, "erro", err.Error())
			continue
		}
		if !saida.Ignorada {
			aplicadas++
			v.log.Info("prazo de decisão vencido", "sagaId", id, "transicao", saida.Transicao, "estado", saida.Solicitacao.Estado)
		}
	}
	return aplicadas
}
