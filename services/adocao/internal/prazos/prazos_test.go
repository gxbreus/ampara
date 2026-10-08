package prazos

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gxbreus/ampara/services/adocao/internal/db"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

// relógio controlado pelo teste
type relogio struct {
	mu sync.Mutex
	t  time.Time
}

func (r *relogio) agora() time.Time        { r.mu.Lock(); defer r.mu.Unlock(); return r.t }
func (r *relogio) avancar(d time.Duration) { r.mu.Lock(); r.t = r.t.Add(d); r.mu.Unlock() }

func preparar(t *testing.T) (*pgxpool.Pool, *repositorio.Repositorio, *relogio) {
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
	_, _ = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	if err := db.Migrar(url); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	rel := &relogio{t: time.Now().UTC()}
	repo := repositorio.Novo(pool, repositorio.Config{TimeoutPasso: 10 * time.Second, PrazoDecisao: 72 * time.Hour, MaxReenvios: 10, Agora: rel.agora})
	return pool, repo, rel
}

func criar(t *testing.T, repo *repositorio.Repositorio) string {
	id := repositorio.NovoUUID()
	if _, err := repo.Criar(context.Background(), repositorio.NovaSolicitacao{ID: id, AdotanteID: "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55", AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}); err != nil {
		t.Fatal(err)
	}
	return id
}

func aplicar(t *testing.T, repo *repositorio.Repositorio, id string, ev saga.Evento) {
	if _, err := repo.Aplicar(context.Background(), id, ev); err != nil {
		t.Fatal(err)
	}
}

func contar(t *testing.T, pool *pgxpool.Pool, id, tipo string) int {
	var n int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE saga_id = $1 AND tipo = $2`, id, tipo).Scan(&n)
	return n
}

func estado(t *testing.T, pool *pgxpool.Pool, id string) (e, desfecho string) {
	var d *string
	_ = pool.QueryRow(context.Background(), `SELECT estado, desfecho FROM solicitacoes WHERE id = $1`, id).Scan(&e, &d)
	if d != nil {
		desfecho = *d
	}
	return
}

func TestNadaVenceAntesDoPrazo(t *testing.T) {
	_, repo, rel := preparar(t)
	criar(t, repo)
	rel.avancar(9 * time.Second)
	if n := Novo(repo, silencioso).Ciclo(context.Background()); n != 0 {
		t.Fatalf("%d transições antes do prazo", n)
	}
}

func TestTimeoutDoT1Falha(t *testing.T) {
	pool, repo, rel := preparar(t)
	id := criar(t, repo)
	rel.avancar(11 * time.Second)
	if n := Novo(repo, silencioso).Ciclo(context.Background()); n != 1 {
		t.Fatalf("transições aplicadas: %d", n)
	}
	if e, _ := estado(t, pool, id); e != "FALHOU" {
		t.Fatalf("estado %s", e)
	}
	if contar(t, pool, id, "LiberarReserva") != 1 || contar(t, pool, id, "adocao.falhou") != 1 {
		t.Fatal("esperava a C1 precautória e adocao.falhou no outbox")
	}
}

func TestExpiracaoDoPrazoDeDecisao(t *testing.T) {
	pool, repo, rel := preparar(t)
	id := criar(t, repo)
	aplicar(t, repo, id, saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"})
	aplicar(t, repo, id, saga.Evento{Tipo: saga.EvPerfilValidado})
	rel.avancar(72*time.Hour + time.Second)
	Novo(repo, silencioso).Ciclo(context.Background())
	if e, d := estado(t, pool, id); e != "COMPENSANDO" || d != "EXPIRADA" {
		t.Fatalf("estado %s, desfecho %s", e, d)
	}
	if contar(t, pool, id, "LiberarVaga") != 1 || contar(t, pool, id, "LiberarReserva") != 1 {
		t.Fatal("a expiração deveria emitir C2 e C1")
	}
}

func TestBackoffEntreReenvios(t *testing.T) {
	pool, repo, rel := preparar(t)
	id := criar(t, repo)
	aplicar(t, repo, id, saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"})
	aplicar(t, repo, id, saga.Evento{Tipo: saga.EvPerfilValidado})
	aplicar(t, repo, id, saga.Evento{Tipo: saga.EvRecusa})
	v := Novo(repo, silencioso)

	rel.avancar(11 * time.Second)
	v.Ciclo(context.Background()) // 1º reenvio; próximo prazo em +10 s
	rel.avancar(9 * time.Second)
	v.Ciclo(context.Background()) // ainda não
	if n := contar(t, pool, id, "LiberarReserva"); n != 2 {
		t.Fatalf("LiberarReserva no outbox: %d, esperado 2 (original + 1 reenvio)", n)
	}
	rel.avancar(2 * time.Second)
	v.Ciclo(context.Background()) // 2º reenvio; próximo prazo em +20 s
	rel.avancar(15 * time.Second)
	v.Ciclo(context.Background()) // o backoff dobrou: ainda não
	if n := contar(t, pool, id, "LiberarReserva"); n != 3 {
		t.Fatalf("LiberarReserva no outbox: %d, esperado 3", n)
	}
}

// Dois verificadores ao mesmo tempo (duas réplicas): cada passo vencido é reenviado uma vez.
func TestDoisVerificadoresReenviamUmaVez(t *testing.T) {
	pool, repo, rel := preparar(t)
	var ids []string
	for i := 0; i < 10; i++ {
		id := repositorio.NovoUUID()
		if _, err := repo.Criar(context.Background(), repositorio.NovaSolicitacao{ID: id, AdotanteID: repositorio.NovoUUID(), AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}); err != nil {
			t.Fatal(err)
		}
		aplicar(t, repo, id, saga.Evento{Tipo: saga.EvAnimalReservado, ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5", AnimalNome: "Thor"})
		aplicar(t, repo, id, saga.Evento{Tipo: saga.EvPerfilValidado})
		aplicar(t, repo, id, saga.Evento{Tipo: saga.EvRecusa})
		ids = append(ids, id)
	}
	rel.avancar(11 * time.Second)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); Novo(repo, silencioso).Ciclo(context.Background()) }()
	}
	wg.Wait()
	for _, id := range ids {
		if a, b := contar(t, pool, id, "LiberarReserva"), contar(t, pool, id, "LiberarVaga"); a != 2 || b != 2 {
			t.Fatalf("solicitação %s: LiberarReserva %d e LiberarVaga %d no outbox; esperado 2 e 2", id, a, b)
		}
	}
}
