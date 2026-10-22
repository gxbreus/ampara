package repositorio

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gxbreus/ampara/services/orquestrador/internal/db"
	"github.com/gxbreus/ampara/services/orquestrador/internal/saga"
)

// Os testes rodam com ORQUESTRADOR_TEST_DATABASE_URL apontando para um PostgreSQL descartável:
// cada teste recria o schema do zero.
func banco(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("ORQUESTRADOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ORQUESTRADOR_TEST_DATABASE_URL não definida")
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
	if _, _, err := r.Criar(context.Background(), NovoUUID(), NovaSaga{ID: id, AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9", CorrelationID: "c-teste"}); err != nil {
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

// ateAguardando leva a SAGA a AGUARDANDO_APROVACAO.
func ateAguardando(t *testing.T, r *Repositorio, id string) {
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"})
	aplicar(t, r, id, saga.Evento{Tipo: saga.EvPerfilValidado})
}

func outboxTipos(t *testing.T, pool *pgxpool.Pool, id string) []string {
	t.Helper()
	// sem o saga.transicao, que sai em toda transição e tem teste próprio
	rows, _ := pool.Query(context.Background(), `SELECT tipo FROM outbox WHERE saga_id = $1 AND tipo <> 'saga.transicao' ORDER BY id`, id)
	defer rows.Close()
	var tipos []string
	for rows.Next() {
		var tipo string
		_ = rows.Scan(&tipo)
		tipos = append(tipos, tipo)
	}
	return tipos
}

func TestCriarGravaSagaPassoEOutbox(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)

	var estado, correlation string
	_ = pool.QueryRow(context.Background(), `SELECT estado, correlation_id FROM sagas WHERE id = $1`, id).Scan(&estado, &correlation)
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
		FROM outbox o JOIN saga_passos p ON p.saga_id = o.saga_id AND p.passo = 'T1' WHERE o.saga_id = $1 AND o.tipo = 'ReservarAnimal'`, id).Scan(&envMsgID, &passoMsgID, &sagaID, &tipo)
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
	_ = pool.QueryRow(context.Background(), `SELECT animal_nome, expira_em FROM sagas WHERE id = $1`, id).Scan(&nome, &expira)
	if nome != "Thor" || expira == nil {
		t.Fatalf("animal_nome %q, expira_em %v", nome, expira)
	}
}

func TestCriarDeduplicaPelaInboxEPelaSaga(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	n := NovaSaga{ID: NovoUUID(), AdotanteID: adotante, AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}
	msg := NovoUUID()
	if _, dup, err := r.Criar(context.Background(), msg, n); err != nil || dup {
		t.Fatalf("primeira: duplicada %v, erro %v", dup, err)
	}
	// reentrega do broker: mesmo messageId
	if _, dup, err := r.Criar(context.Background(), msg, n); err != nil || !dup {
		t.Fatalf("a mesma mensagem deveria ser reconhecida pela inbox: duplicada %v, erro %v", dup, err)
	}
	// a Adoção republicou com outro messageId: a SAGA já existe e nada muda
	saida, dup, err := r.Criar(context.Background(), NovoUUID(), n)
	if err != nil || dup || !saida.Ignorada {
		t.Fatalf("a SAGA já existente deveria ser ignorada: %+v %v %v", saida, dup, err)
	}
	if got := outboxTipos(t, pool, n.ID); len(got) != 1 || got[0] != "ReservarAnimal" {
		t.Fatalf("outbox = %v, esperado um único ReservarAnimal", got)
	}
}

func TestCadaTransicaoPublicaSagaTransicaoComVersao(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)
	ateAguardando(t, r, id)

	rows, _ := pool.Query(context.Background(), `SELECT payload FROM outbox WHERE saga_id = $1 AND tipo = 'saga.transicao' ORDER BY id`, id)
	var payloads []map[string]any
	for rows.Next() {
		var env struct {
			Type    string         `json:"type"`
			SagaID  string         `json:"sagaId"`
			Payload map[string]any `json:"payload"`
		}
		var corpo []byte
		_ = rows.Scan(&corpo)
		if err := json.Unmarshal(corpo, &env); err != nil || env.Type != "saga.transicao" || env.SagaID != id {
			t.Fatalf("envelope inválido: %s", corpo)
		}
		payloads = append(payloads, env.Payload)
	}
	rows.Close()
	if len(payloads) != 3 {
		t.Fatalf("%d saga.transicao, esperado 3 (criação, reserva e perfil)", len(payloads))
	}
	estados := []string{"SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO"}
	for i, p := range payloads {
		if p["versao"] != float64(i+1) || p["estado"] != estados[i] || p["solicitacaoId"] != id {
			t.Fatalf("transição %d: %v", i, p)
		}
	}
	if payloads[0]["de"] != nil || payloads[0]["transicao"] != float64(1) || payloads[0]["evento"] != "SolicitacaoCriada" {
		t.Fatalf("a primeira transição deveria sair do nada: %v", payloads[0])
	}
	ultima := payloads[2]
	if ultima["de"] != "ANIMAL_RESERVADO" || ultima["animalNome"] != "Thor" || ultima["expiraEm"] == nil || ultima["passo"] != "T2" {
		t.Fatalf("a última transição deveria levar o nome, o prazo e o passo: %v", ultima)
	}
}

func TestAplicarMensagemDeduplicaPelaInbox(t *testing.T) {
	pool := banco(t)
	r := repo(pool, 10)
	id := criar(t, r)
	msg := NovoUUID()
	ev := saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"}
	if s, dup, err := r.AplicarMensagem(context.Background(), msg, "AnimalReservado", id, ev); err != nil || dup || s.Transicao != 2 {
		t.Fatalf("primeira: %+v %v %v", s, dup, err)
	}
	if _, dup, err := r.AplicarMensagem(context.Background(), msg, "AnimalReservado", id, ev); err != nil || !dup {
		t.Fatalf("a reentrega deveria ser descartada: %v %v", dup, err)
	}
	if _, _, err := r.AplicarMensagem(context.Background(), NovoUUID(), "AnimalReservado", NovoUUID(), ev); !errors.Is(err, ErrNaoEncontrada) {
		t.Fatalf("SAGA inexistente: %v", err)
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
	_ = pool.QueryRow(context.Background(), `SELECT s.requer_intervencao, p.status FROM sagas s
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
			t.Fatalf("rodada %d: a aprovação perdedora deveria dar ErrEstadoNaoPermite: %v", i, errAprovacao)
		}
	}
}
