package db

import (
	"context"
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Roda só com ORQUESTRADOR_TEST_DATABASE_URL apontando para um PostgreSQL descartável.
func TestMigrationsSobemDescemESobem(t *testing.T) {
	url := os.Getenv("ORQUESTRADOR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("ORQUESTRADOR_TEST_DATABASE_URL não definida")
	}
	if err := Migrar(url); err != nil {
		t.Fatalf("up: %v", err)
	}
	fonte, _ := iofs.New(migrations, "migrations")
	m, err := migrate.NewWithSourceInstance("iofs", fonte, paraDriverPgx(url))
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Down(); err != nil {
		t.Fatalf("down: %v", err)
	}
	m.Close()
	if err := Migrar(url); err != nil {
		t.Fatalf("up de novo: %v", err)
	}

	pool, err := Conectar(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ctx := context.Background()
	ins := `INSERT INTO sagas (id, adotante_id, animal_id, estado) VALUES (gen_random_uuid(), $1, 'a1', $2)`
	adotante := "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"
	// a regra de uma solicitação ativa por animal é da Adoção: aqui duas SAGAs podem coexistir
	for _, estado := range []string{"SOLICITADA", "AGUARDANDO_APROVACAO"} {
		if _, err := pool.Exec(ctx, ins, adotante, estado); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, ins, adotante, "INVENTADO"); err == nil {
		t.Error("estado fora da lista deveria ser recusado")
	}
}
