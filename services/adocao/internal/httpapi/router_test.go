package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

type bancoFalso struct{ err error }

func (b bancoFalso) Ping(context.Context) error { return b.err }

func requisitar(t *testing.T, banco Pinger, caminho string, cabecalhos map[string]string) (*httptest.ResponseRecorder, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	req := httptest.NewRequest(http.MethodGet, caminho, nil)
	for k, v := range cabecalhos {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	NovoRouter(banco, log, "adocao-teste").ServeHTTP(rec, req)
	return rec, &logs
}

func TestHealthResponde200(t *testing.T) {
	rec, _ := requisitar(t, bancoFalso{err: errors.New("fora do ar")}, "/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, esperado 200 mesmo com o banco fora do ar", rec.Code)
	}
}

func TestReadyDependeDoBanco(t *testing.T) {
	casos := []struct {
		nome   string
		banco  Pinger
		status int
	}{
		{"banco respondendo", bancoFalso{}, http.StatusOK},
		{"banco fora do ar", bancoFalso{err: errors.New("conexão recusada")}, http.StatusServiceUnavailable},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			rec, _ := requisitar(t, c.banco, "/ready", nil)
			if rec.Code != c.status {
				t.Fatalf("status = %d, esperado %d", rec.Code, c.status)
			}
		})
	}
}

func TestReadyIndisponivelRespondeProblemDetails(t *testing.T) {
	rec, _ := requisitar(t, bancoFalso{err: errors.New("fora do ar")}, "/ready", nil)
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	var corpo map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&corpo); err != nil || corpo["status"] != float64(503) {
		t.Fatalf("corpo inesperado: %v (%v)", corpo, err)
	}
}

func TestCabecalhosEmTodaResposta(t *testing.T) {
	rec, _ := requisitar(t, bancoFalso{}, "/rota-que-nao-existe", nil)
	if rec.Header().Get("X-Served-By") != "adocao-teste" {
		t.Fatalf("X-Served-By ausente numa resposta 404")
	}
}

func TestCorrelationIdPropagadoOuGerado(t *testing.T) {
	rec, logs := requisitar(t, bancoFalso{}, "/health", map[string]string{"X-Correlation-Id": "c-123"})
	if got := rec.Header().Get("X-Correlation-Id"); got != "c-123" {
		t.Fatalf("X-Correlation-Id = %q, esperado o recebido", got)
	}
	var linha map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &linha); err != nil {
		t.Fatalf("log não é JSON: %v", err)
	}
	if linha["correlationId"] != "c-123" {
		t.Fatalf("log sem correlationId: %v", linha)
	}

	rec, _ = requisitar(t, bancoFalso{}, "/health", nil)
	uuid := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !uuid.MatchString(rec.Header().Get("X-Correlation-Id")) {
		t.Fatalf("correlationId gerado não é um UUID v4: %q", rec.Header().Get("X-Correlation-Id"))
	}
	_, _ = io.Copy(io.Discard, rec.Body)
}
