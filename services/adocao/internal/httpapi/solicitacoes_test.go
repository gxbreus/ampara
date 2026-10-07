package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/gxbreus/ampara/services/adocao/internal/auth"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

const (
	adotanteID    = "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"
	responsavelID = "c50a83ab-7db0-41b4-9436-4144c36f97d5"
	animalID      = "65a2f1c4e8b9d3a7f0c1b2e9"
)

var chave, outraChave *rsa.PrivateKey

func init() {
	chave, _ = rsa.GenerateKey(rand.Reader, 2048)
	outraChave, _ = rsa.GenerateKey(rand.Reader, 2048)
}

func verificador(t *testing.T) *auth.Verificador {
	der, _ := x509.MarshalPKIXPublicKey(&chave.PublicKey)
	v, err := auth.NovoVerificador(string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})))
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func token(t *testing.T, sub, role string, k *rsa.PrivateKey) string {
	s, err := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss": auth.Emissor, "sub": sub, "role": role, "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString(k)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

type repoFalso struct {
	criados  []repositorio.NovaSolicitacao
	chaves   map[string]string
	errCriar error
	visoes   map[string]repositorio.Visao
	eventos  []saga.TipoEvento
	filtros  []repositorio.Filtro
}

func (r *repoFalso) CriarIdempotente(_ context.Context, n repositorio.NovaSolicitacao, chave string) (string, bool, error) {
	if r.errCriar != nil {
		return "", false, r.errCriar
	}
	if id, ok := r.chaves[chave]; ok && chave != "" {
		return id, true, nil
	}
	r.criados = append(r.criados, n)
	if chave != "" {
		r.chaves[chave] = n.ID
	}
	r.visoes[n.ID] = repositorio.Visao{ID: n.ID, Estado: saga.Solicitada, AnimalID: n.AnimalID, AdotanteID: n.AdotanteID,
		CriadoEm: time.Now(), AtualizadoEm: time.Now()}
	return n.ID, false, nil
}

func (r *repoFalso) Obter(_ context.Context, id string) (repositorio.Visao, error) {
	v, ok := r.visoes[id]
	if !ok {
		return v, repositorio.ErrNaoEncontrada
	}
	return v, nil
}

// Aplicar usa a máquina de estados de verdade, só sem banco.
func (r *repoFalso) Aplicar(_ context.Context, id string, ev saga.Evento) (saga.Saida, error) {
	v, ok := r.visoes[id]
	if !ok {
		return saga.Saida{}, repositorio.ErrNaoEncontrada // como o repositório real
	}
	s := saga.Solicitacao{ID: id, AdotanteID: v.AdotanteID, AnimalID: v.AnimalID, ResponsavelID: v.ResponsavelID, Estado: v.Estado,
		RequerIntervencao: v.RequerIntervencao}
	out, err := saga.Transicao(s, ev, saga.Regras{Agora: time.Now(), PrazoDecisao: time.Hour, MaxReenvios: 3})
	if err != nil {
		return out, err
	}
	r.eventos = append(r.eventos, ev.Tipo)
	v.Estado, v.Desfecho, v.Motivo = out.Solicitacao.Estado, out.Solicitacao.Desfecho, out.Solicitacao.Motivo
	r.visoes[id] = v
	return out, nil
}

func (r *repoFalso) Listar(_ context.Context, f repositorio.Filtro) ([]repositorio.Visao, string, error) {
	r.filtros = append(r.filtros, f)
	if f.Cursor == "invalido" {
		return nil, "", repositorio.ErrCursorInvalido
	}
	var itens []repositorio.Visao
	for _, v := range r.visoes {
		if (f.AdotanteID == "" || v.AdotanteID == f.AdotanteID) && (f.ResponsavelID == "" || v.ResponsavelID == f.ResponsavelID) {
			itens = append(itens, v)
		}
	}
	return itens, "proximo", nil
}

func (r *repoFalso) Resumir(context.Context, string) (repositorio.Resumo, error) {
	return repositorio.Resumo{PorEstado: map[string]int{"AGUARDANDO_APROVACAO": 1}, AtivasPorAnimal: map[string]int{animalID: 1}, ConcluidasNoMes: 2}, nil
}

func (r *repoFalso) Historico(context.Context, string) ([]repositorio.ItemHistorico, error) {
	return []repositorio.ItemHistorico{
		{Para: "SOLICITADA", Evento: "SolicitacaoCriada", Em: time.Now()},
		{De: "SOLICITADA", Para: "ANIMAL_RESERVADO", Evento: "AnimalReservado", Passo: "T1", Em: time.Now()},
	}, nil
}

func postar(t *testing.T, repo *repoFalso, autorizacao, corpo string, cab map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	h := NovoRouter(Dependencias{Banco: bancoFalso{}, Solicitacoes: repo, Verificador: verificador(t),
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)), ServidoPor: "teste"})
	req := httptest.NewRequest(http.MethodPost, "/v1/solicitacoes", strings.NewReader(corpo))
	if autorizacao != "" {
		req.Header.Set("Authorization", autorizacao)
	}
	req.Header.Set("X-Correlation-Id", "c-post")
	for k, v := range cab {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func novoRepo() *repoFalso {
	return &repoFalso{chaves: map[string]string{}, visoes: map[string]repositorio.Visao{}}
}

func TestPostCria202ComLocationEHAL(t *testing.T) {
	repo := novoRepo()
	rec := postar(t, repo, "Bearer "+token(t, adotanteID, "ADOTANTE", chave), `{"animalId":"`+animalID+`"}`, nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var corpo map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&corpo)
	id := corpo["id"].(string)
	if rec.Header().Get("Location") != "/v1/solicitacoes/"+id || rec.Header().Get("Content-Type") != "application/hal+json" {
		t.Fatalf("Location %q, Content-Type %q", rec.Header().Get("Location"), rec.Header().Get("Content-Type"))
	}
	if corpo["estado"] != "SOLICITADA" || corpo["animalNome"] != nil || corpo["responsavelId"] != nil {
		t.Fatalf("corpo: %v", corpo)
	}
	links := corpo["_links"].(map[string]any)
	if len(links) != 3 || links["self"] == nil || links["animal"] == nil || links["historico"] == nil {
		t.Fatalf("em SOLICITADA só self, animal e historico: %v", links)
	}
	if n := repo.criados[0]; n.AdotanteID != adotanteID || n.AnimalID != animalID || n.CorrelationID != "c-post" {
		t.Fatalf("o adotante vem do sub e o correlationId do header: %+v", n)
	}
}

func TestPostRecusas(t *testing.T) {
	ok := `{"animalId":"` + animalID + `"}`
	casos := []struct {
		nome, autorizacao, corpo string
		cab                      map[string]string
		repo                     *repoFalso
		status                   int
	}{
		{"sem token", "", ok, nil, novoRepo(), 401},
		{"token de outra chave", "Bearer " + token(t, adotanteID, "ADOTANTE", outraChave), ok, nil, novoRepo(), 401},
		{"role de ONG", "Bearer " + token(t, responsavelID, "ONG", chave), ok, nil, novoRepo(), 403},
		{"animalId inválido", "Bearer " + token(t, adotanteID, "ADOTANTE", chave), `{"animalId":"thor"}`, nil, novoRepo(), 422},
		{"campo desconhecido", "Bearer " + token(t, adotanteID, "ADOTANTE", chave), `{"animalId":"` + animalID + `","x":1}`, nil, novoRepo(), 422},
		{"Idempotency-Key curta", "Bearer " + token(t, adotanteID, "ADOTANTE", chave), ok, map[string]string{"Idempotency-Key": "abc"}, novoRepo(), 422},
		{"solicitação ativa", "Bearer " + token(t, adotanteID, "ADOTANTE", chave), ok, nil, &repoFalso{chaves: map[string]string{}, visoes: map[string]repositorio.Visao{}, errCriar: repositorio.ErrSolicitacaoAtiva}, 409},
	}
	for _, c := range casos {
		rec := postar(t, c.repo, c.autorizacao, c.corpo, c.cab)
		if rec.Code != c.status || rec.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("%s: status %d (%s), esperado %d", c.nome, rec.Code, rec.Header().Get("Content-Type"), c.status)
		}
	}
}

func TestPostIdempotente(t *testing.T) {
	repo := novoRepo()
	auth := "Bearer " + token(t, adotanteID, "ADOTANTE", chave)
	cab := map[string]string{"Idempotency-Key": "3d9b1f2e-0a6c-4f7e-8b15-c2e4a9d07f63"}
	a := postar(t, repo, auth, `{"animalId":"`+animalID+`"}`, cab)
	b := postar(t, repo, auth, `{"animalId":"`+animalID+`"}`, cab)
	if a.Code != 202 || b.Code != 202 || a.Header().Get("Location") != b.Header().Get("Location") || len(repo.criados) != 1 {
		t.Fatalf("a mesma chave deveria devolver a mesma solicitação: %d %d %q %q, criadas %d",
			a.Code, b.Code, a.Header().Get("Location"), b.Header().Get("Location"), len(repo.criados))
	}
}

func TestLinksPorEstadoEPapel(t *testing.T) {
	acoes := func(l map[string]link) string {
		var a []string
		for _, nome := range []string{"aprovar", "recusar", "cancelar"} {
			if _, ok := l[nome]; ok {
				a = append(a, nome)
			}
		}
		return strings.Join(a, ",")
	}
	for _, e := range []saga.Estado{saga.Solicitada, saga.AnimalReservado, saga.AguardandoAprovacao, saga.Aprovada, saga.Compensando,
		saga.Concluida, saga.RejeitadaIndisponivel, saga.PerfilInvalido, saga.Recusada, saga.Cancelada, saga.Expirada, saga.Falhou} {
		v := repositorio.Visao{ID: "s", Estado: e, AnimalID: animalID}
		for _, p := range []Papel{Responsavel, Adotante, Outro} {
			l := Links(v, p)
			if l["self"].Href != "/v1/solicitacoes/s" || l["animal"].Href != "/v1/animais/"+animalID || l["historico"].Href != "/v1/solicitacoes/s/historico" {
				t.Fatalf("links base errados em %s: %v", e, l)
			}
			if _, tem := l["adotante"]; tem {
				t.Fatal("não existe link adotante")
			}
			want := ""
			if e == saga.AguardandoAprovacao {
				want = map[Papel]string{Responsavel: "aprovar,recusar", Adotante: "cancelar"}[p]
			}
			if got := acoes(l); got != want {
				t.Errorf("%s, papel %d: ações %q, esperado %q", e, p, got, want)
			}
		}
	}
}
