package repositorio

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gxbreus/ampara/services/adocao/internal/db"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

// Os testes rodam com ADOCAO_TEST_DATABASE_URL apontando para um PostgreSQL descartável:
// cada teste recria o schema do zero.
func banco(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("ADOCAO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ADOCAO_TEST_DATABASE_URL não definida")
	}
	ctx := context.Background()
	pool, err := db.Conectar(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrar(url); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func repo(pool *pgxpool.Pool) *Repositorio { return Novo(pool, Config{}) }

const (
	adotante    = "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"
	responsavel = "c50a83ab-7db0-41b4-9436-4144c36f97d5"
	admin       = "ad000000-0000-4000-8000-000000000001"
)

func criar(t *testing.T, r *Repositorio) string {
	t.Helper()
	id := NovoUUID()
	if err := r.Criar(context.Background(), NovaSolicitacao{ID: id, AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9", CorrelationID: "c-teste"}); err != nil {
		t.Fatal(err)
	}
	return id
}

func ptr[T any](v T) *T { return &v }

// mover aplica, em ordem, os saga.transicao que o Orquestrador publicaria, a partir da
// versão atual do espelho. Cada passo é "ESTADO" ou "ESTADO:Evento".
func mover(t *testing.T, r *Repositorio, id string, passos ...string) {
	t.Helper()
	var versao int
	var estado string
	_ = r.pool.QueryRow(context.Background(), `SELECT versao, estado FROM solicitacoes WHERE id = $1`, id).Scan(&versao, &estado)
	if versao == 0 {
		estado = "" // a primeira transição sai do nada
	}
	for _, p := range passos {
		para, evento, _ := strings.Cut(p, ":")
		versao++
		tr := Transicao{SolicitacaoID: id, Versao: versao, Estado: para, Evento: evento, Transicao: versao, Em: time.Now().UTC(),
			AnimalNome: ptr("Thor"), ResponsavelID: ptr(responsavel)}
		if estado != "" {
			tr.De = ptr(estado)
		}
		if _, err := r.AplicarTransicao(context.Background(), NovoUUID(), tr); err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		estado = para
	}
}

// ateAguardando leva o espelho a AGUARDANDO_APROVACAO.
func ateAguardando(t *testing.T, r *Repositorio, id string) {
	mover(t, r, id, "SOLICITADA:SolicitacaoCriada", "ANIMAL_RESERVADO:AnimalReservado", "AGUARDANDO_APROVACAO:PerfilValidado")
}

// outbox devolve as mensagens gravadas para a solicitação, em ordem: tipo e payload.
func outbox(t *testing.T, pool *pgxpool.Pool, id string) ([]string, []map[string]any) {
	t.Helper()
	rows, _ := pool.Query(context.Background(), `SELECT tipo, exchange, routing_key, payload FROM outbox WHERE saga_id = $1 ORDER BY id`, id)
	defer rows.Close()
	var tipos []string
	var payloads []map[string]any
	for rows.Next() {
		var tipo, exchange, rk string
		var corpo []byte
		_ = rows.Scan(&tipo, &exchange, &rk, &corpo)
		var env Envelope
		if err := json.Unmarshal(corpo, &env); err != nil || env.Type != tipo || env.SagaID != id || exchange != "ampara.eventos" || rk != tipo {
			t.Fatalf("mensagem mal formada: %s %s %s %s", tipo, exchange, rk, corpo)
		}
		tipos, payloads = append(tipos, tipo), append(payloads, env.Payload)
	}
	return tipos, payloads
}

func TestCriarGravaSolicitacaoEPublicaCriada(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	id := criar(t, r)

	v, err := r.Obter(context.Background(), id)
	if err != nil || v.Estado != saga.Solicitada || v.AdotanteID != adotante || v.Decisao != "" {
		t.Fatalf("Obter: %+v %v", v, err)
	}
	tipos, payloads := outbox(t, pool, id)
	if len(tipos) != 1 || tipos[0] != TipoCriada {
		t.Fatalf("outbox = %v, esperado só solicitacao.criada", tipos)
	}
	if p := payloads[0]; p["solicitacaoId"] != id || p["adotanteId"] != adotante || p["animalId"] != "65a2f1c4e8b9d3a7f0c1b2e9" {
		t.Fatalf("payload: %v", p)
	}
	if _, err := r.Obter(context.Background(), NovoUUID()); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("Obter de id inexistente: %v", err)
	}
}

func TestSolicitacaoAtivaDuplicada(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	criar(t, r)
	err := r.Criar(context.Background(), NovaSolicitacao{ID: NovoUUID(), AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"})
	if !errors.Is(err, ErrSolicitacaoAtiva) {
		t.Fatalf("erro = %v, esperado ErrSolicitacaoAtiva", err)
	}
	var mensagens int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox`).Scan(&mensagens)
	if mensagens != 1 {
		t.Fatalf("a recusada não pode deixar mensagem no outbox: %d", mensagens)
	}
}

func TestDecidirSoEmAguardandoEUmaVez(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	id := criar(t, r)
	if err := r.Decidir(context.Background(), id, saga.Aprovar, "", responsavel); !errors.Is(err, ErrEstadoNaoPermite) {
		t.Fatalf("antes de AGUARDANDO_APROVACAO: %v", err)
	}
	ateAguardando(t, r, id)
	if err := r.Decidir(context.Background(), id, saga.Recusar, "sem tela", responsavel); err != nil {
		t.Fatal(err)
	}
	if err := r.Decidir(context.Background(), id, saga.Cancelar, "", adotante); !errors.Is(err, ErrEstadoNaoPermite) {
		t.Fatalf("segunda decisão: %v", err)
	}
	if err := r.Decidir(context.Background(), NovoUUID(), saga.Aprovar, "", responsavel); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("inexistente: %v", err)
	}

	v, _ := r.Obter(context.Background(), id)
	if v.Decisao != saga.Recusar || v.Estado != saga.AguardandoAprovacao {
		t.Fatalf("a decisão fica registrada e o estado espera o Orquestrador: %+v", v)
	}
	tipos, payloads := outbox(t, pool, id)
	if len(tipos) != 2 || tipos[1] != TipoDecidida {
		t.Fatalf("outbox = %v", tipos)
	}
	if p := payloads[1]; p["decisao"] != "RECUSADA" || p["motivo"] != "sem tela" || p["decididaPor"] != responsavel || p["solicitacaoId"] != id {
		t.Fatalf("payload: %v", p)
	}
}

func TestAprovarECancelarAoMesmoTempo(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	for i := 0; i < 20; i++ {
		id := criar(t, r)
		ateAguardando(t, r, id)
		var wg sync.WaitGroup
		erros := make([]error, 2)
		wg.Add(2)
		go func() { defer wg.Done(); erros[0] = r.Decidir(context.Background(), id, saga.Aprovar, "", responsavel) }()
		go func() { defer wg.Done(); erros[1] = r.Decidir(context.Background(), id, saga.Cancelar, "", adotante) }()
		wg.Wait()
		venceram := 0
		for _, err := range erros {
			if err == nil {
				venceram++
			} else if !errors.Is(err, ErrEstadoNaoPermite) {
				t.Fatalf("rodada %d: %v", i, err)
			}
		}
		if venceram != 1 {
			t.Fatalf("rodada %d: exatamente uma decisão deveria vencer: %v", i, erros)
		}
		// encerra a solicitação para liberar o índice único da próxima rodada
		mover(t, r, id, "FALHOU")
	}
}

func TestRetomarSoComIntervencao(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	id := criar(t, r)
	if err := r.Retomar(context.Background(), id, admin); !errors.Is(err, ErrEstadoNaoPermite) {
		t.Fatalf("sem intervenção: %v", err)
	}
	if err := r.Retomar(context.Background(), NovoUUID(), admin); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("inexistente: %v", err)
	}
	if _, err := r.AplicarTransicao(context.Background(), NovoUUID(), Transicao{SolicitacaoID: id, Versao: 1, Estado: "COMPENSANDO",
		Desfecho: ptr("RECUSADA"), RequerIntervencao: true, Evento: "Timeout", Passo: ptr("C1"), Transicao: 13, Em: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := r.Retomar(context.Background(), id, admin); err != nil {
		t.Fatal(err)
	}
	tipos, payloads := outbox(t, pool, id)
	if len(tipos) != 2 || tipos[1] != TipoRetomada || payloads[1]["pedidaPor"] != admin {
		t.Fatalf("outbox = %v %v", tipos, payloads)
	}
}

func TestAplicarTransicaoForaDeOrdemEDuplicada(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	id := criar(t, r)
	ctx := context.Background()
	expira := time.Now().Add(72 * time.Hour).UTC().Truncate(time.Second)
	v1 := Transicao{SolicitacaoID: id, Versao: 1, Estado: "SOLICITADA", Evento: "SolicitacaoCriada", Transicao: 1, Em: time.Now().UTC()}
	v2 := Transicao{SolicitacaoID: id, Versao: 2, De: ptr("SOLICITADA"), Estado: "ANIMAL_RESERVADO", Evento: "AnimalReservado",
		Passo: ptr("T1"), Transicao: 2, AnimalNome: ptr("Thor"), ResponsavelID: ptr(responsavel), Em: time.Now().UTC()}
	v3 := Transicao{SolicitacaoID: id, Versao: 3, De: ptr("ANIMAL_RESERVADO"), Estado: "AGUARDANDO_APROVACAO", Evento: "PerfilValidado",
		Passo: ptr("T2"), Transicao: 5, ExpiraEm: &expira, Em: time.Now().UTC()}

	// chegam fora de ordem: 2, 3 e só depois 1
	msg2 := NovoUUID()
	for _, c := range []struct {
		msg string
		t   Transicao
	}{{msg2, v2}, {NovoUUID(), v3}, {NovoUUID(), v1}} {
		if dup, err := r.AplicarTransicao(ctx, c.msg, c.t); err != nil || dup {
			t.Fatalf("versão %d: %v %v", c.t.Versao, dup, err)
		}
	}
	// a reentrega da versão 2 cai na inbox
	if dup, err := r.AplicarTransicao(ctx, msg2, v2); err != nil || !dup {
		t.Fatalf("reentrega: %v %v", dup, err)
	}
	// a mesma versão com outro messageId não duplica a linha do tempo
	if _, err := r.AplicarTransicao(ctx, NovoUUID(), v2); err != nil {
		t.Fatal(err)
	}

	v, _ := r.Obter(ctx, id)
	// a versão 1, atrasada, não volta o estado; a 3 não traz nome, e o da 2 continua
	if v.Estado != saga.AguardandoAprovacao || v.AnimalNome != "Thor" || v.ResponsavelID != responsavel || v.ExpiraEm == nil || !v.ExpiraEm.Equal(expira) {
		t.Fatalf("espelho: %+v", v)
	}
	h, err := r.Historico(ctx, id)
	if err != nil || len(h) != 3 || h[0].Para != "SOLICITADA" || h[1].Para != "ANIMAL_RESERVADO" || h[2].Para != "AGUARDANDO_APROVACAO" || h[2].Passo != "T2" {
		t.Fatalf("linha do tempo: %+v %v", h, err)
	}
	if _, err := r.AplicarTransicao(ctx, NovoUUID(), Transicao{SolicitacaoID: NovoUUID(), Versao: 1, Estado: "SOLICITADA", Em: time.Now()}); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("solicitação inexistente: %v", err)
	}
}

func TestCriarIdempotente(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	n := func() NovaSolicitacao {
		return NovaSolicitacao{ID: NovoUUID(), AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}
	}
	id1, existente, err := r.CriarIdempotente(context.Background(), n(), "chave-123456")
	if err != nil || existente {
		t.Fatalf("primeira: %v %v", existente, err)
	}
	id2, existente, err := r.CriarIdempotente(context.Background(), n(), "chave-123456")
	if err != nil || !existente || id2 != id1 {
		t.Fatalf("a mesma chave deveria devolver %s: %s %v %v", id1, id2, existente, err)
	}
	if _, _, err := r.CriarIdempotente(context.Background(), n(), "outra-chave-789"); !errors.Is(err, ErrSolicitacaoAtiva) {
		t.Fatalf("outra chave para o mesmo animal ativo deveria dar 409: %v", err)
	}
}

func TestCriarIdempotenteConcorrente(t *testing.T) {
	pool := banco(t)
	r := repo(pool)
	const n = 10
	ids := make([]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ids[i], _, errs[i] = r.CriarIdempotente(context.Background(),
				NovaSolicitacao{ID: NovoUUID(), AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}, "chave-concorrente")
		}(i)
	}
	wg.Wait()
	for i := 0; i < n; i++ {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Fatalf("requisição %d: id %s (primeira %s), erro %v", i, ids[i], ids[0], errs[i])
		}
	}
	var total, mensagens int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM solicitacoes`).Scan(&total)
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox`).Scan(&mensagens)
	if total != 1 || mensagens != 1 {
		t.Fatalf("%d solicitações e %d mensagens no outbox; esperado 1 e 1", total, mensagens)
	}
}
