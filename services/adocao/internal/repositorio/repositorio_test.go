package repositorio

import (
	"context"
	"errors"
	"os"
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

func repo(pool *pgxpool.Pool, max int) *Repositorio {
	return Novo(pool, Config{TimeoutPasso: 10 * time.Second, PrazoDecisao: 72 * time.Hour, MaxReenvios: max})
}

const adotante = "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"

func criar(t *testing.T, r *Repositorio) string {
	t.Helper()
	id := NovoUUID()
	if _, err := r.Criar(context.Background(), NovaSolicitacao{ID: id, AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9", CorrelationID: "c-teste"}); err != nil {
		t.Fatal(err)
	}
	return id
}

func aplicar(t *testing.T, r *Repositorio, id string, ev saga.Evento) saga.Saida {
	t.Helper()
	s, err := r.Aplicar(context.Background(), id, ev)
	if err != nil {
		t.Fatalf("%s: %v", ev.Tipo, err)
	}
	return s
}

// ateAguardando leva a solicitação a AGUARDANDO_APROVACAO.
func ateAguardando(t *testing.T, r *Repositorio, id string) {
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"})
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvPerfilValidado})
}

func outboxTipos(t *testing.T, pool *pgxpool.Pool, id string) []string {
	t.Helper()
	rows, _ := pool.Query(context.Background(), `SELECT tipo FROM outbox WHERE saga_id = $1 ORDER BY id`, id)
	defer rows.Close()
	var tipos []string
	for rows.Next() {
		var tipo string
		_ = rows.Scan(&tipo)
		tipos = append(tipos, tipo)
	}
	return tipos
}

func TestCriarGravaSolicitacaoPassoEOutbox(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)

	var estado, correlation string
	_ = pool.QueryRow(context.Background(), `SELECT estado, correlation_id FROM solicitacoes WHERE id = $1`, id).Scan(&estado, &correlation)
	if estado != "SOLICITADA" || correlation != "c-teste" {
		t.Fatalf("estado %s, correlation %s", estado, correlation)
	}
	var status string
	var prazo *time.Time
	_ = pool.QueryRow(context.Background(), `SELECT status, prazo FROM saga_passos WHERE saga_id = $1 AND passo = 'T1'`, id).Scan(&status, &prazo)
	if status != "PENDENTE" || prazo == nil {
		t.Fatalf("T1: status %s, prazo %v", status, prazo)
	}
	var envMsgID, passoMsgID, sagaID, tipo string
	_ = pool.QueryRow(context.Background(), `SELECT o.message_id, p.message_id, o.payload->>'sagaId', o.payload->>'type'
		FROM outbox o JOIN saga_passos p ON p.saga_id = o.saga_id AND p.passo = 'T1' WHERE o.saga_id = $1`, id).Scan(&envMsgID, &passoMsgID, &sagaID, &tipo)
	if envMsgID != passoMsgID || sagaID != id || tipo != "ReservarAnimal" {
		t.Fatalf("outbox e passo divergem: %s %s %s %s", envMsgID, passoMsgID, sagaID, tipo)
	}
}

func TestFluxoAteAguardandoAprovacao(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)
	ateAguardando(t, r, id)

	got := outboxTipos(t, pool, id)
	want := []string{"ReservarAnimal", "ValidarPerfil", "adocao.aguardando_aprovacao"}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("outbox = %v, esperado %v", got, want)
	}
	var linhas int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM saga_historico WHERE saga_id = $1`, id).Scan(&linhas)
	if linhas != 3 {
		t.Fatalf("histórico com %d linhas, esperado 3", linhas)
	}
	var nome string
	var expira *time.Time
	_ = pool.QueryRow(context.Background(), `SELECT animal_nome, expira_em FROM solicitacoes WHERE id = $1`, id).Scan(&nome, &expira)
	if nome != "Thor" || expira == nil {
		t.Fatalf("animal_nome %q, expira_em %v", nome, expira)
	}
}

func TestSolicitacaoAtivaDuplicada(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	criar(t, r)
	_, err := r.Criar(context.Background(), NovaSolicitacao{ID: NovoUUID(), AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"})
	if !errors.Is(err, ErrSolicitacaoAtiva) {
		t.Fatalf("erro = %v, esperado ErrSolicitacaoAtiva", err)
	}
}

func TestReenvioUsaOMesmoMessageID(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)
	ateAguardando(t, r, id)
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvRecusa})
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvTimeout, Passo: saga.C1})

	var ids []string
	rows, _ := pool.Query(context.Background(), `SELECT message_id FROM outbox WHERE saga_id = $1 AND tipo = 'LiberarReserva' ORDER BY id`, id)
	for rows.Next() {
		var m string
		_ = rows.Scan(&m)
		ids = append(ids, m)
	}
	rows.Close()
	if len(ids) != 2 || ids[0] != ids[1] {
		t.Fatalf("o reenvio deveria repetir o messageId: %v", ids)
	}
	var tentativas int
	_ = pool.QueryRow(context.Background(), `SELECT tentativas FROM saga_passos WHERE saga_id = $1 AND passo = 'C1'`, id).Scan(&tentativas)
	if tentativas != 1 {
		t.Fatalf("tentativas = %d", tentativas)
	}
}

func TestTetoDeReenviosMarcaIntervencao(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 1)
	id := criar(t, r)
	ateAguardando(t, r, id)
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvCancelamento})
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvTimeout, Passo: saga.C1}) // 1º reenvio
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvTimeout, Passo: saga.C1}) // teto

	var intervencao bool
	var status string
	_ = pool.QueryRow(context.Background(), `SELECT s.requer_intervencao, p.status FROM solicitacoes s
		JOIN saga_passos p ON p.saga_id = s.id AND p.passo = 'C1' WHERE s.id = $1`, id).Scan(&intervencao, &status)
	if !intervencao || status != "ESGOTADO" {
		t.Fatalf("requer_intervencao %v, status %s", intervencao, status)
	}
}

func TestAprovacaoEExpiracaoSimultaneas(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	for i := 0; i < 20; i++ {
		id := criar(t, r)
		ateAguardando(t, r, id)

		var wg sync.WaitGroup
		var errAprovacao error
		var expiracao saga.Saida
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, errAprovacao = r.Aplicar(context.Background(), id, saga.Evento{Tipo: saga.EvAprovacao})
		}()
		go func() {
			defer wg.Done()
			expiracao, _ = r.Aplicar(context.Background(), id, saga.Evento{Tipo: saga.EvPrazoExpirado})
		}()
		wg.Wait()

		aprovou := errAprovacao == nil
		expirou := !expiracao.Ignorada
		if aprovou == expirou {
			t.Fatalf("rodada %d: exatamente uma deveria vencer (aprovou=%v expirou=%v, erro=%v)", i, aprovou, expirou, errAprovacao)
		}
		if !aprovou && !errors.Is(errAprovacao, saga.ErrEstadoNaoPermite) {
			t.Fatalf("rodada %d: a aprovação perdedora deveria dar 409: %v", i, errAprovacao)
		}
		// encerra a solicitação para liberar o índice único da próxima rodada
		_, _ = pool.Exec(context.Background(), `UPDATE solicitacoes SET estado = 'FALHOU' WHERE id = $1`, id)
	}
}

func TestCriarIdempotente(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
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
	v, err := r.Obter(context.Background(), id1)
	if err != nil || v.Estado != saga.Solicitada || v.AdotanteID != adotante {
		t.Fatalf("Obter: %+v %v", v, err)
	}
	if _, err := r.Obter(context.Background(), NovoUUID()); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("Obter de id inexistente: %v", err)
	}
}

func TestCriarIdempotenteConcorrente(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
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
	var total, outbox int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM solicitacoes`).Scan(&total)
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox`).Scan(&outbox)
	if total != 1 || outbox != 1 {
		t.Fatalf("%d solicitações e %d mensagens no outbox; esperado 1 e 1", total, outbox)
	}
}
