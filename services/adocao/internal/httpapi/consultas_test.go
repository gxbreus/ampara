package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

const outroID = "9b2d4f6a-1c3e-4a5b-8d7f-0e1a2b3c4d5e"

// aguardando: uma solicitação em AGUARDANDO_APROVACAO no repositório falso
func aguardando(repo *repoFalso, id string) {
	repo.visoes[id] = repositorio.Visao{ID: id, Estado: saga.AguardandoAprovacao, AnimalID: animalID, AnimalNome: "Thor",
		AdotanteID: adotanteID, ResponsavelID: responsavelID, CriadoEm: time.Now(), AtualizadoEm: time.Now()}
}

func chamar(t *testing.T, repo *repoFalso, metodo, caminho, sub, role, corpo string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	h := NovoRouter(Dependencias{Banco: bancoFalso{}, Solicitacoes: repo, Verificador: verificador(t),
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)), ServidoPor: "teste"})
	req := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if sub != "" {
		req.Header.Set("Authorization", "Bearer "+token(t, sub, role, chave))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var m map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	return rec, m
}

func TestObterAutorizacao(t *testing.T) {
	repo := novoRepo()
	aguardando(repo, "s1")
	casos := []struct {
		sub, role string
		status    int
		acoes     []string
	}{
		{responsavelID, "ONG", 200, []string{"aprovar", "recusar"}},
		{adotanteID, "ADOTANTE", 200, []string{"cancelar"}},
		{outroID, "ADMIN", 200, nil},
		{outroID, "ADOTANTE", 403, nil},
	}
	for _, c := range casos {
		rec, corpo := chamar(t, repo, "GET", "/v1/solicitacoes/s1", c.sub, c.role, "")
		if rec.Code != c.status {
			t.Errorf("%s/%s: status %d, esperado %d", c.sub, c.role, rec.Code, c.status)
			continue
		}
		if c.status != 200 {
			continue
		}
		links := corpo["_links"].(map[string]any)
		for _, a := range []string{"aprovar", "recusar", "cancelar"} {
			_, tem := links[a]
			esperado := false
			for _, e := range c.acoes {
				esperado = esperado || e == a
			}
			if tem != esperado {
				t.Errorf("%s/%s: link %s presente=%v", c.sub, c.role, a, tem)
			}
		}
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes/nao-existe", adotanteID, "ADOTANTE", ""); rec.Code != 404 {
		t.Errorf("inexistente: %d", rec.Code)
	}
}

func TestAcoesPorPapelEEstado(t *testing.T) {
	casos := []struct {
		nome, caminho, sub, role, corpo string
		status                          int
		estado, desfecho                string
	}{
		{"responsável aprova", "aprovacao", responsavelID, "ONG", "", 202, "APROVADA", ""},
		{"responsável recusa com motivo", "recusa", responsavelID, "ONG", `{"motivo":"sem tela"}`, 202, "COMPENSANDO", "RECUSADA"},
		{"responsável recusa sem corpo", "recusa", responsavelID, "ONG", "", 202, "COMPENSANDO", "RECUSADA"},
		{"adotante cancela", "cancelamento", adotanteID, "ADOTANTE", "", 202, "COMPENSANDO", "CANCELADA"},
		{"adotante tenta aprovar", "aprovacao", adotanteID, "ADOTANTE", "", 403, "", ""},
		{"responsável tenta cancelar", "cancelamento", responsavelID, "ONG", "", 403, "", ""},
		{"ADMIN tenta aprovar", "aprovacao", outroID, "ADMIN", "", 403, "", ""},
		{"recusa com campo desconhecido", "recusa", responsavelID, "ONG", `{"motivo":"x","nota":1}`, 422, "", ""},
		{"recusa com motivo longo", "recusa", responsavelID, "ONG", `{"motivo":"` + strings.Repeat("a", 501) + `"}`, 422, "", ""},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			repo := novoRepo()
			aguardando(repo, "s1")
			rec, corpo := chamar(t, repo, "POST", "/v1/solicitacoes/s1/"+c.caminho, c.sub, c.role, c.corpo)
			if rec.Code != c.status {
				t.Fatalf("status %d, esperado %d: %s", rec.Code, c.status, rec.Body)
			}
			if c.status != 202 {
				if len(repo.eventos) != 0 {
					t.Fatalf("nenhuma transição deveria ter sido aplicada: %v", repo.eventos)
				}
				return
			}
			if corpo["estado"] != c.estado || (c.desfecho != "" && corpo["desfecho"] != c.desfecho) {
				t.Fatalf("estado %v, desfecho %v", corpo["estado"], corpo["desfecho"])
			}
			if links := corpo["_links"].(map[string]any); links["aprovar"] != nil || links["cancelar"] != nil {
				t.Fatalf("fora de AGUARDANDO_APROVACAO não há ações: %v", links)
			}
		})
	}
}

func TestDuploCliqueNaAprovacaoDa409(t *testing.T) {
	repo := novoRepo()
	aguardando(repo, "s1")
	if rec, _ := chamar(t, repo, "POST", "/v1/solicitacoes/s1/aprovacao", responsavelID, "ONG", ""); rec.Code != 202 {
		t.Fatalf("primeira: %d", rec.Code)
	}
	rec, corpo := chamar(t, repo, "POST", "/v1/solicitacoes/s1/aprovacao", responsavelID, "ONG", "")
	if rec.Code != 409 || corpo["type"] != "https://ampara.dev/problemas/estado-nao-permite-acao" {
		t.Fatalf("segunda: %d %v", rec.Code, corpo)
	}
	if len(repo.eventos) != 1 {
		t.Fatalf("só uma aprovação deveria ter sido aplicada: %v", repo.eventos)
	}
}

func TestListar(t *testing.T) {
	repo := novoRepo()
	aguardando(repo, "s1")
	rec, corpo := chamar(t, repo, "GET", "/v1/solicitacoes?responsavelId="+responsavelID+"&ativa=true&limite=10", responsavelID, "ONG", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/hal+json" {
		t.Fatalf("status %d", rec.Code)
	}
	itens := corpo["_embedded"].(map[string]any)["solicitacoes"].([]any)
	if len(itens) != 1 || itens[0].(map[string]any)["_links"].(map[string]any)["aprovar"] == nil {
		t.Fatalf("itens: %v", itens)
	}
	next := corpo["_links"].(map[string]any)["next"].(map[string]any)["href"].(string)
	if !strings.Contains(next, "cursor=proximo") || !strings.Contains(next, "responsavelId="+responsavelID) {
		t.Fatalf("next deveria manter os filtros e trazer o cursor: %s", next)
	}
	f := repo.filtros[0]
	if f.Ativa == nil || !*f.Ativa || f.Limite != 10 {
		t.Fatalf("filtro: %+v", f)
	}

	recusas := map[string]int{
		"/v1/solicitacoes":                                                     422, // sem filtro
		"/v1/solicitacoes?responsavelId=" + outroID:                            403, // responsável de outra pessoa
		"/v1/solicitacoes?animalId=" + animalID:                                403, // nem adotante nem responsável é o sub
		"/v1/solicitacoes?responsavelId=" + responsavelID + "&estado=X":        422,
		"/v1/solicitacoes?responsavelId=" + responsavelID + "&limite=0":        422,
		"/v1/solicitacoes?responsavelId=" + responsavelID + "&cursor=invalido": 422,
	}
	for caminho, status := range recusas {
		if rec, _ := chamar(t, repo, "GET", caminho, responsavelID, "ONG", ""); rec.Code != status {
			t.Errorf("%s: %d, esperado %d", caminho, rec.Code, status)
		}
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes?animalId="+animalID, outroID, "ADMIN", ""); rec.Code != 200 {
		t.Errorf("ADMIN pode filtrar por qualquer coisa: %d", rec.Code)
	}
}

func TestResumo(t *testing.T) {
	repo := novoRepo()
	rec, corpo := chamar(t, repo, "GET", "/v1/solicitacoes/resumo?responsavelId="+responsavelID, responsavelID, "ONG", "")
	if rec.Code != 200 || corpo["concluidasNoMes"] != float64(2) || corpo["porEstado"].(map[string]any)["AGUARDANDO_APROVACAO"] != float64(1) {
		t.Fatalf("%d %v", rec.Code, corpo)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes/resumo?responsavelId="+outroID, responsavelID, "ONG", ""); rec.Code != 403 {
		t.Errorf("resumo de outro responsável: %d", rec.Code)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes/resumo", responsavelID, "ONG", ""); rec.Code != 422 {
		t.Errorf("sem responsavelId: %d", rec.Code)
	}
}

func TestHistorico(t *testing.T) {
	repo := novoRepo()
	aguardando(repo, "s1")
	rec, corpo := chamar(t, repo, "GET", "/v1/solicitacoes/s1/historico", adotanteID, "ADOTANTE", "")
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	itens := corpo["itens"].([]any)
	primeiro, segundo := itens[0].(map[string]any), itens[1].(map[string]any)
	if primeiro["de"] != nil || primeiro["passo"] != nil || segundo["de"] != "SOLICITADA" || segundo["passo"] != "T1" {
		t.Fatalf("itens: %v", itens)
	}
	if _, tem := primeiro["transicao"]; tem {
		t.Fatal("o contrato não expõe o número da transição")
	}
	links := corpo["_links"].(map[string]any)
	if links["self"].(map[string]any)["href"] != "/v1/solicitacoes/s1/historico" || links["solicitacao"] == nil {
		t.Fatalf("links: %v", links)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes/s1/historico", outroID, "ADOTANTE", ""); rec.Code != http.StatusForbidden {
		t.Errorf("histórico de outra pessoa: %d", rec.Code)
	}
}

func TestRetomadaSoParaAdmin(t *testing.T) {
	esgotada := func(repo *repoFalso) {
		repo.visoes["s1"] = repositorio.Visao{ID: "s1", Estado: saga.Compensando, Desfecho: saga.Recusada, AnimalID: animalID,
			AdotanteID: adotanteID, ResponsavelID: responsavelID, RequerIntervencao: true, CriadoEm: time.Now(), AtualizadoEm: time.Now()}
	}
	repo := novoRepo()
	esgotada(repo)
	if rec, _ := chamar(t, repo, "POST", "/v1/solicitacoes/s1/compensacao/retomada", responsavelID, "ONG", ""); rec.Code != 403 {
		t.Errorf("responsável: %d, esperado 403", rec.Code)
	}
	if rec, _ := chamar(t, repo, "POST", "/v1/solicitacoes/nao-existe/compensacao/retomada", outroID, "ADMIN", ""); rec.Code != 404 {
		t.Errorf("inexistente: %d, esperado 404", rec.Code)
	}
	// o repositório falso não tem passos: a máquina não acha passo esgotado e responde 409
	rec, corpo := chamar(t, repo, "POST", "/v1/solicitacoes/s1/compensacao/retomada", outroID, "ADMIN", "")
	if rec.Code != 409 || corpo["type"] != "https://ampara.dev/problemas/nada-a-retomar" {
		t.Errorf("sem passo esgotado: %d %v", rec.Code, corpo)
	}
}

func TestRequerIntervencaoNaRepresentacaoENoFiltro(t *testing.T) {
	repo := novoRepo()
	aguardando(repo, "s1")
	_, corpo := chamar(t, repo, "GET", "/v1/solicitacoes/s1", adotanteID, "ADOTANTE", "")
	if v, ok := corpo["requerIntervencao"]; !ok || v != false {
		t.Fatalf("requerIntervencao ausente: %v", corpo)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes?requerIntervencao=true", outroID, "ADMIN", ""); rec.Code != 200 {
		t.Fatalf("ADMIN lista a fila de intervenção: %d", rec.Code)
	}
	if f := repo.filtros[len(repo.filtros)-1]; f.RequerIntervencao == nil || !*f.RequerIntervencao {
		t.Fatalf("filtro não repassado: %+v", f)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes?requerIntervencao=true", responsavelID, "ONG", ""); rec.Code != 403 {
		t.Errorf("só ADMIN vê a fila inteira: %d", rec.Code)
	}
	if rec, _ := chamar(t, repo, "GET", "/v1/solicitacoes?requerIntervencao=talvez", outroID, "ADMIN", ""); rec.Code != 422 {
		t.Errorf("valor inválido: %d", rec.Code)
	}
}
