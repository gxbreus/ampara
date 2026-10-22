// Package httpapi expõe as rotas de saúde do Orquestrador. Ele não tem rotas de negócio:
// tudo o que move a SAGA chega por mensagem (ADR-008).
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// Pinger é o que o /ready precisa do banco; o *pgxpool.Pool atende.
type Pinger interface {
	Ping(ctx context.Context) error
}

// NovoRouter monta /health e /ready. servidoPor vai no header X-Served-By (o hostname).
func NovoRouter(banco Pinger, log *slog.Logger, servidoPor string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		escreverJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := banco.Ping(ctx); err != nil {
			log.WarnContext(r.Context(), "banco indisponível", "erro", err.Error())
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"type":   "https://ampara.dev/problemas/servico-indisponivel",
				"title":  "Serviço indisponível",
				"status": http.StatusServiceUnavailable,
				"detail": "O PostgreSQL do Orquestrador não respondeu.",
			})
			return
		}
		escreverJSON(w, http.StatusOK, map[string]string{"status": "pronto"})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Served-By", servidoPor)
		mux.ServeHTTP(w, r)
	})
}

func escreverJSON(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(corpo)
}
