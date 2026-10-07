package outbox

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gxbreus/ampara/services/adocao/internal/db"
)

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

func popular(t *testing.T, pool *pgxpool.Pool, n int) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `INSERT INTO outbox (message_id, saga_id, tipo, exchange, routing_key, payload)
		SELECT gen_random_uuid(), gen_random_uuid(), 'ReservarAnimal', 'ampara.comandos', 'animais', '{"correlationId":"c"}'
		FROM generate_series(1, $1)`, n)
	if err != nil {
		t.Fatal(err)
	}
}

type publicadorFalso struct {
	mu       sync.Mutex
	vezes    map[string]int
	falharEm int // falha na n-ésima publicação (0 = nunca)
	contagem int
}

func (p *publicadorFalso) Publicar(_ context.Context, m Mensagem) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.contagem++
	if p.falharEm > 0 && p.contagem == p.falharEm {
		return errors.New("broker fora do ar")
	}
	if p.vezes == nil {
		p.vezes = map[string]int{}
	}
	p.vezes[m.MessageID]++
	return nil
}

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

func pendentes(t *testing.T, pool *pgxpool.Pool) int {
	var n int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE publicado_em IS NULL`).Scan(&n)
	return n
}

func TestCicloPublicaEMarca(t *testing.T) {
	pool := banco(t)
	popular(t, pool, 5)
	pub := &publicadorFalso{}
	n, err := NovoRelay(pool, pub, silencioso).Ciclo(context.Background())
	if err != nil || n != 5 || pendentes(t, pool) != 0 {
		t.Fatalf("publicadas %d, pendentes %d, erro %v", n, pendentes(t, pool), err)
	}
}

func TestFalhaDePublicacaoMantemORestantePendente(t *testing.T) {
	pool := banco(t)
	popular(t, pool, 5)
	pub := &publicadorFalso{falharEm: 3}
	n, _ := NovoRelay(pool, pub, silencioso).Ciclo(context.Background())
	if n != 2 || pendentes(t, pool) != 3 {
		t.Fatalf("publicadas %d, pendentes %d; esperado 2 e 3", n, pendentes(t, pool))
	}
	// no ciclo seguinte, o broker voltou
	n, _ = NovoRelay(pool, pub, silencioso).Ciclo(context.Background())
	if n != 3 || pendentes(t, pool) != 0 {
		t.Fatalf("segundo ciclo: publicadas %d, pendentes %d", n, pendentes(t, pool))
	}
}

// Duas réplicas do relay ao mesmo tempo: cada mensagem é publicada uma vez (SKIP LOCKED).
func TestDuasReplicasNaoPublicamEmDobro(t *testing.T) {
	pool := banco(t)
	popular(t, pool, 500)
	pub := &publicadorFalso{}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		r := NovoRelay(pool, pub, silencioso)
		r.Lote = 20
		wg.Add(1)
		go func() {
			defer wg.Done()
			for pendentes(t, pool) > 0 {
				if _, err := r.Ciclo(context.Background()); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	wg.Wait()
	if len(pub.vezes) != 500 {
		t.Fatalf("publicadas %d mensagens distintas, esperado 500", len(pub.vezes))
	}
	for id, v := range pub.vezes {
		if v != 1 {
			t.Fatalf("mensagem %s publicada %d vezes", id, v)
		}
	}
}

// Com RabbitMQ real (ADOCAO_TEST_AMQP_URL, usuário com permissão de publicar em ampara.comandos).
func TestPublicadorAMQPReal(t *testing.T) {
	url := os.Getenv("ADOCAO_TEST_AMQP_URL")
	if url == "" {
		t.Skip("ADOCAO_TEST_AMQP_URL não definida")
	}
	p := NovoPublicadorAMQP(url)
	defer p.Fechar()
	m := Mensagem{MessageID: "11111111-2222-4333-8444-555555555555", Tipo: "ReservarAnimal", Exchange: "ampara.comandos",
		RoutingKey: "animais", CorrelationID: "c-amqp", Corpo: []byte(`{"type":"ReservarAnimal"}`)}
	if err := p.Publicar(context.Background(), m); err != nil {
		t.Fatalf("publicar com confirm: %v", err)
	}
	m.RoutingKey = "nao-existe"
	if err := p.Publicar(context.Background(), m); err == nil {
		t.Fatal("routing key sem fila deveria falhar (mandatory + return)")
	} else {
		fmt.Println("esperado:", err)
	}
}
