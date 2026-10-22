package repositorio

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

// solicitação de um adotante novo, para não esbarrar no índice de ativa única
func nova(t *testing.T, r *Repositorio, animal string) string {
	t.Helper()
	id := NovoUUID()
	if err := r.Criar(context.Background(), NovaSolicitacao{ID: id, AdotanteID: NovoUUID(), AnimalID: animal}); err != nil {
		t.Fatal(err)
	}
	return id
}

func reservar(t *testing.T, r *Repositorio, id string) {
	mover(t, r, id, "SOLICITADA:SolicitacaoCriada", "ANIMAL_RESERVADO:AnimalReservado")
}

func TestListarPaginaSemRepetirNemPular(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	criadas := map[string]bool{}
	for i := 0; i < 7; i++ {
		id := nova(t, r, "65a2f1c4e8b9d3a7f0c1b2e9")
		reservar(t, r, id)
		criadas[id] = true
	}
	vistas := map[string]bool{}
	cursor, paginas := "", 0
	for {
		itens, proximo, err := r.Listar(context.Background(), Filtro{ResponsavelID: responsavel, Limite: 3, Cursor: cursor})
		if err != nil {
			t.Fatal(err)
		}
		paginas++
		for _, v := range itens {
			if vistas[v.ID] {
				t.Fatalf("%s apareceu duas vezes", v.ID)
			}
			vistas[v.ID] = true
		}
		if proximo == "" {
			break
		}
		cursor = proximo
	}
	if paginas != 3 || len(vistas) != 7 {
		t.Fatalf("%d páginas e %d itens; esperado 3 e 7", paginas, len(vistas))
	}
	if _, _, err := r.Listar(context.Background(), Filtro{ResponsavelID: responsavel, Cursor: "lixo"}); !errors.Is(err, ErrCursorInvalido) {
		t.Fatalf("cursor inválido: %v", err)
	}
}

func TestListarFiltros(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	ativa := nova(t, r, "65a2f1c4e8b9d3a7f0c1b201")
	reservar(t, r, ativa)
	encerrada := nova(t, r, "65a2f1c4e8b9d3a7f0c1b202")
	// recusada logo na reserva: o saga.transicao não traz responsável
	for i, e := range []string{"SOLICITADA", "REJEITADA_INDISPONIVEL"} {
		if _, err := r.AplicarTransicao(context.Background(), NovoUUID(), Transicao{SolicitacaoID: encerrada, Versao: i + 1,
			Estado: e, Evento: "ReservaRecusada", Em: time.Now()}); err != nil {
			t.Fatal(err)
		}
	}

	sim, nao := true, false
	casos := []struct {
		nome    string
		f       Filtro
		quer    string
		quantos int
	}{
		{"ativa=true", Filtro{Ativa: &sim}, ativa, 1},
		{"ativa=false", Filtro{Ativa: &nao}, encerrada, 1},
		{"por estado", Filtro{Estado: saga.RejeitadaIndisponivel}, encerrada, 1},
		{"por animal", Filtro{AnimalID: "65a2f1c4e8b9d3a7f0c1b201"}, ativa, 1},
		{"por responsável", Filtro{ResponsavelID: responsavel}, ativa, 1}, // a recusada nunca teve responsável
	}
	for _, c := range casos {
		itens, _, err := r.Listar(context.Background(), c.f)
		if err != nil || len(itens) != c.quantos || itens[0].ID != c.quer {
			t.Errorf("%s: %d itens, erro %v", c.nome, len(itens), err)
		}
	}
}

func TestResumoComTresEstados(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	// 1 aguardando, 1 recusada e 1 concluída, do mesmo responsável
	aguardando := nova(t, r, "65a2f1c4e8b9d3a7f0c1b201")
	reservar(t, r, aguardando)
	mover(t, r, aguardando, "AGUARDANDO_APROVACAO:PerfilValidado")

	recusada := nova(t, r, "65a2f1c4e8b9d3a7f0c1b202")
	reservar(t, r, recusada)
	mover(t, r, recusada, "AGUARDANDO_APROVACAO:PerfilValidado", "COMPENSANDO:Recusa", "COMPENSANDO:VagaLiberada", "RECUSADA:ReservaLiberada")

	concluida := nova(t, r, "65a2f1c4e8b9d3a7f0c1b203")
	reservar(t, r, concluida)
	mover(t, r, concluida, "AGUARDANDO_APROVACAO:PerfilValidado", "APROVADA:Aprovacao", "APROVADA:AdocaoConfirmada", "CONCLUIDA:AdocaoRegistrada")

	res, err := r.Resumir(context.Background(), responsavel)
	if err != nil {
		t.Fatal(err)
	}
	if res.PorEstado["AGUARDANDO_APROVACAO"] != 1 || res.PorEstado["RECUSADA"] != 1 || res.PorEstado["CONCLUIDA"] != 1 || len(res.PorEstado) != 3 {
		t.Errorf("porEstado: %v", res.PorEstado)
	}
	if len(res.AtivasPorAnimal) != 1 || res.AtivasPorAnimal["65a2f1c4e8b9d3a7f0c1b201"] != 1 {
		t.Errorf("ativasPorAnimal: %v", res.AtivasPorAnimal)
	}
	if res.ConcluidasNoMes != 1 {
		t.Errorf("concluidasNoMes: %d", res.ConcluidasNoMes)
	}

	h, err := r.Historico(context.Background(), recusada)
	if err != nil {
		t.Fatal(err)
	}
	var trilha []string
	for _, i := range h {
		trilha = append(trilha, i.Para)
	}
	want := []string{"SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "COMPENSANDO", "COMPENSANDO", "RECUSADA"}
	if len(trilha) != len(want) {
		t.Fatalf("linha do tempo: %v", trilha)
	}
	for i := range want {
		if trilha[i] != want[i] {
			t.Fatalf("linha do tempo fora de ordem: %v", trilha)
		}
	}
	if h[5].Evento != "ReservaLiberada" || h[4].Evento != "VagaLiberada" {
		t.Errorf("o encerramento vem depois das duas compensações: %+v", h[4:])
	}
}
