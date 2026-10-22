// Package db conecta ao PostgreSQL da Adoção e aplica as migrations embutidas no binário.
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Conectar abre o pool e espera o banco responder, por até 30 s.
func Conectar(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("configurar pool: %w", err)
	}
	prazo := time.Now().Add(30 * time.Second)
	for {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			return pool, nil
		}
		if time.Now().After(prazo) {
			pool.Close()
			return nil, fmt.Errorf("banco não respondeu: %w", err)
		}
		time.Sleep(time.Second)
	}
}

// Migrar aplica as migrations pendentes. Rodar de novo sem mudanças não faz nada.
func Migrar(url string) error {
	fonte, err := iofs.New(migrations, "migrations")
	if err != nil {
		return fmt.Errorf("ler migrations: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", fonte, paraDriverPgx(url))
	if err != nil {
		return fmt.Errorf("preparar migrations: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("aplicar migrations: %w", err)
	}
	return nil
}

// O golang-migrate escolhe o driver pelo esquema da URL: pgx5:// em vez de postgres://.
func paraDriverPgx(url string) string {
	for _, prefixo := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(url, prefixo) {
			return "pgx5://" + strings.TrimPrefix(url, prefixo)
		}
	}
	return url
}
