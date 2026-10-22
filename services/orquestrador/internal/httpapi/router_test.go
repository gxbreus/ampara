package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

type bancoFalso struct{ err error }

func (b bancoFalso) Ping(context.Context) error { return b.err }

func requisitar(banco Pinger, caminho string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	NovoRouter(banco, log, "orquestrador-teste").ServeHTTP(rec, httptest.NewRequest(http.MethodGet, caminho, nil))
	return rec
}

func TestHealthResponde200MesmoComOBancoForaDoAr(t *testing.T) {
	rec := requisitar(bancoFalso{err: errors.New("fora do ar")}, "/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("X-Served-By") != "orquestrador-teste" {
		t.Errorf("X-Served-By = %q", rec.Header().Get("X-Served-By"))
	}
}

func TestReadyDependeDoBanco(t *testing.T) {
	if rec := requisitar(bancoFalso{}, "/ready"); rec.Code != http.StatusOK {
		t.Fatalf("banco respondendo: status = %d", rec.Code)
	}
	rec := requisitar(bancoFalso{err: errors.New("conexão recusada")}, "/ready")
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("banco fora: status = %d, Content-Type = %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var p map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || p["status"] != float64(503) {
		t.Fatalf("problem details inválido: %s", rec.Body.String())
	}
}

func TestSemRotasDeNegocio(t *testing.T) {
	if rec := requisitar(bancoFalso{}, "/v1/solicitacoes"); rec.Code != http.StatusNotFound {
		t.Fatalf("o Orquestrador não expõe rotas de negócio: status = %d", rec.Code)
	}
}
