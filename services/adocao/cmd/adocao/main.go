// Comando adocao: o serviço de Adoção, orquestrador da SAGA (#58).
//
//	adocao              sobe o servidor HTTP
//	adocao healthcheck  confere o /health; usado pelo healthcheck do contêiner,
//	                    porque a imagem distroless não tem curl nem wget
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/auth"
	"github.com/gxbreus/ampara/services/adocao/internal/config"
	"github.com/gxbreus/ampara/services/adocao/internal/consumidor"
	"github.com/gxbreus/ampara/services/adocao/internal/db"
	"github.com/gxbreus/ampara/services/adocao/internal/httpapi"
	"github.com/gxbreus/ampara/services/adocao/internal/outbox"
	"github.com/gxbreus/ampara/services/adocao/internal/prazos"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("servico", "adocao")
	if err := executar(log); err != nil {
		log.Error("serviço encerrado com erro", "erro", err.Error())
		os.Exit(1)
	}
}

func executar(log *slog.Logger) error {
	cfg, err := config.Carregar()
	if err != nil {
		return err
	}
	verificador, err := auth.NovoVerificador(cfg.JWTPublicKey)
	if err != nil {
		return err
	}

	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer parar()

	pool, err := db.Conectar(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := db.Migrar(cfg.DatabaseURL); err != nil {
		return err
	}
	log.Info("migrations aplicadas")

	// o único caminho de publicação: o relay do outbox (docs/dados.md, seção 5.3)
	publicador := outbox.NovoPublicadorAMQP(cfg.AMQPURL)
	defer publicador.Fechar()
	go outbox.NovoRelay(pool, publicador, log).Rodar(ctx)

	repo := repositorio.Novo(pool, repositorio.Config{
		TimeoutPasso: cfg.TimeoutPasso, PrazoDecisao: cfg.PrazoDecisao, MaxReenvios: cfg.MaxReenvios,
	})
	go consumidor.Novo(repo, log).Rodar(ctx, cfg.AMQPURL)
	// timeouts, expiração e retomada depois de um reinício
	go prazos.Novo(repo, log).Rodar(ctx)

	hostname, _ := os.Hostname()
	srv := &http.Server{
		Addr: ":" + cfg.Porta,
		Handler: httpapi.NovoRouter(httpapi.Dependencias{
			Banco: pool, Solicitacoes: repo, Verificador: verificador, Log: log, ServidoPor: hostname,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	erros := make(chan error, 1)
	go func() {
		log.Info("ouvindo", "porta", cfg.Porta)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			erros <- err
		}
	}()

	select {
	case err := <-erros:
		return err
	case <-ctx.Done():
	}

	log.Info("encerrando")
	desligar, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	return srv.Shutdown(desligar)
}

func healthcheck() int {
	porta := os.Getenv("ADOCAO_PORTA")
	if porta == "" {
		porta = "8080"
	}
	cliente := http.Client{Timeout: 2 * time.Second}
	resp, err := cliente.Get("http://localhost:" + porta + "/health")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
