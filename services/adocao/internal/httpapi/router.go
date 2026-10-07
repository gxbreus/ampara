// Package httpapi expõe as rotas HTTP da Adoção.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Pinger é o que o /ready precisa do banco; o *pgxpool.Pool atende.
type Pinger interface {
	Ping(ctx context.Context) error
}

type chaveContexto struct{}

// CorrelationID devolve o id de correlação da requisição, posto no contexto pelo middleware.
func CorrelationID(ctx context.Context) string {
	id, _ := ctx.Value(chaveContexto{}).(string)
	return id
}

// NovoRouter monta as rotas. servidoPor vai no header X-Served-By (o hostname do contêiner).
func NovoRouter(banco Pinger, log *slog.Logger, servidoPor string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		escreverJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := banco.Ping(ctx); err != nil {
			log.WarnContext(r.Context(), "banco indisponível", "correlationId", CorrelationID(r.Context()), "erro", err.Error())
			escreverProblema(w, http.StatusServiceUnavailable, "servico-indisponivel", "Serviço indisponível", "O PostgreSQL da Adoção não respondeu.")
			return
		}
		escreverJSON(w, http.StatusOK, map[string]string{"status": "pronto"})
	})
	return middleware(mux, log, servidoPor)
}

// middleware propaga o X-Correlation-Id (ou cria um), responde com X-Served-By e registra
// cada requisição em JSON.
func middleware(proximo http.Handler, log *slog.Logger, servidoPor string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		id := r.Header.Get("X-Correlation-Id")
		if id == "" {
			id = novoUUID()
		}
		w.Header().Set("X-Correlation-Id", id)
		w.Header().Set("X-Served-By", servidoPor)

		rw := &respostaComStatus{ResponseWriter: w, status: http.StatusOK}
		proximo.ServeHTTP(rw, r.WithContext(context.WithValue(r.Context(), chaveContexto{}, id)))

		log.Info("requisição",
			"correlationId", id,
			"metodo", r.Method,
			"caminho", r.URL.Path,
			"status", rw.status,
			"duracaoMs", time.Since(inicio).Milliseconds(),
		)
	})
}

type respostaComStatus struct {
	http.ResponseWriter
	status int
}

func (r *respostaComStatus) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func escreverJSON(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(corpo)
}

func escreverProblema(w http.ResponseWriter, status int, tipo, titulo, detalhe string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "https://ampara.dev/problemas/" + tipo,
		"title":  titulo,
		"status": status,
		"detail": detalhe,
	})
}

func novoUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
