package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/auth"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

// Solicitacoes é a parte do repositório que a API usa.
type Solicitacoes interface {
	CriarIdempotente(ctx context.Context, n repositorio.NovaSolicitacao, chave string) (string, bool, error)
	Obter(ctx context.Context, id string) (repositorio.Visao, error)
	Aplicar(ctx context.Context, id string, ev saga.Evento) (saga.Saida, error)
	Listar(ctx context.Context, f repositorio.Filtro) ([]repositorio.Visao, string, error)
	Resumir(ctx context.Context, responsavelID string) (repositorio.Resumo, error)
	Historico(ctx context.Context, id string) ([]repositorio.ItemHistorico, error)
}

type Verificador interface {
	Verificar(token string) (auth.Usuario, error)
}

type handlerSolicitacoes struct {
	repo Solicitacoes
	auth Verificador
	log  *slog.Logger
}

var objectID = regexp.MustCompile(`^[0-9a-f]{24}$`)

// criar: POST /v1/solicitacoes (docs/contratos/adocao.v1.yaml). O 202 significa que a
// SAGA começou, não que a adoção foi aceita: o cliente acompanha pelo Location.
func (h *handlerSolicitacoes) criar(w http.ResponseWriter, r *http.Request) {
	usuario, ok := h.autenticar(w, r)
	if !ok {
		return
	}
	if usuario.Role != "ADOTANTE" {
		escreverProblema(w, http.StatusForbidden, "sem-permissao", "Sem permissão", "Só adotantes podem solicitar uma adoção.")
		return
	}

	var corpo struct {
		AnimalID string `json:"animalId"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&corpo); err != nil || !objectID.MatchString(corpo.AnimalID) {
		escreverProblema(w, http.StatusUnprocessableEntity, "validacao", "Dados inválidos", "animalId deve ser o identificador de um animal (24 caracteres hexadecimais).")
		return
	}
	chave := r.Header.Get("Idempotency-Key")
	if chave != "" && (len(chave) < 8 || len(chave) > 128) {
		escreverProblema(w, http.StatusUnprocessableEntity, "validacao", "Dados inválidos", "Idempotency-Key deve ter de 8 a 128 caracteres.")
		return
	}

	id, existente, err := h.repo.CriarIdempotente(r.Context(), repositorio.NovaSolicitacao{
		ID: repositorio.NovoUUID(), AdotanteID: usuario.Sub, AnimalID: corpo.AnimalID, CorrelationID: CorrelationID(r.Context()),
	}, chave)
	switch {
	case errors.Is(err, repositorio.ErrSolicitacaoAtiva):
		escreverProblema(w, http.StatusConflict, "solicitacao-ativa-existente", "Solicitação ativa existente", "Já existe uma solicitação em andamento para este animal.")
		return
	case err != nil:
		h.log.ErrorContext(r.Context(), "criar solicitação", "correlationId", CorrelationID(r.Context()), "erro", err.Error())
		escreverProblema(w, http.StatusInternalServerError, "erro-interno", "Erro interno", "Não foi possível registrar a solicitação.")
		return
	}

	v, err := h.repo.Obter(r.Context(), id)
	if err != nil {
		escreverProblema(w, http.StatusInternalServerError, "erro-interno", "Erro interno", "Não foi possível ler a solicitação.")
		return
	}
	if !existente {
		h.log.InfoContext(r.Context(), "solicitação criada", "correlationId", CorrelationID(r.Context()), "sagaId", id, "animalId", corpo.AnimalID)
	}
	w.Header().Set("Location", "/v1/solicitacoes/"+id)
	escreverHAL(w, http.StatusAccepted, representar(v, papel(v, usuario)))
}

func (h *handlerSolicitacoes) autenticar(w http.ResponseWriter, r *http.Request) (auth.Usuario, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || token == "" {
		escreverProblema(w, http.StatusUnauthorized, "nao-autenticado", "Não autenticado", "Envie um token Bearer válido.")
		return auth.Usuario{}, false
	}
	u, err := h.auth.Verificar(token)
	if err != nil {
		escreverProblema(w, http.StatusUnauthorized, "nao-autenticado", "Não autenticado", "Token inválido ou expirado.")
		return auth.Usuario{}, false
	}
	return u, true
}

// Papel de quem pede, para montar os links.
type Papel int

const (
	Outro Papel = iota
	Adotante
	Responsavel
)

func papel(v repositorio.Visao, u auth.Usuario) Papel {
	switch {
	case u.Sub == v.AdotanteID:
		return Adotante
	case v.ResponsavelID != "" && u.Sub == v.ResponsavelID:
		return Responsavel
	}
	return Outro
}

type link struct {
	Href   string `json:"href"`
	Method string `json:"method,omitempty"`
}

// Links segue a tabela do contrato: self, animal e historico sempre; ações só em
// AGUARDANDO_APROVACAO, conforme o papel. Não existe link adotante.
func Links(v repositorio.Visao, p Papel) map[string]link {
	self := "/v1/solicitacoes/" + v.ID
	l := map[string]link{
		"self":      {Href: self},
		"animal":    {Href: "/v1/animais/" + v.AnimalID},
		"historico": {Href: self + "/historico"},
	}
	if v.Estado == saga.AguardandoAprovacao {
		switch p {
		case Responsavel:
			l["aprovar"] = link{Href: self + "/aprovacao", Method: http.MethodPost}
			l["recusar"] = link{Href: self + "/recusa", Method: http.MethodPost}
		case Adotante:
			l["cancelar"] = link{Href: self + "/cancelamento", Method: http.MethodPost}
		}
	}
	return l
}

func representar(v repositorio.Visao, p Papel) map[string]any {
	data := func(t *time.Time) any {
		if t == nil {
			return nil
		}
		return t.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"id":            v.ID,
		"estado":        v.Estado,
		"desfecho":      nuloSeVazio(string(v.Desfecho)),
		"motivo":        nuloSeVazio(v.Motivo),
		"animalId":      v.AnimalID,
		"animalNome":    nuloSeVazio(v.AnimalNome),
		"adotanteId":    v.AdotanteID,
		"responsavelId": nuloSeVazio(v.ResponsavelID),
		"expiraEm":      data(v.ExpiraEm),
		"criadoEm":      v.CriadoEm.UTC().Format(time.RFC3339),
		"atualizadoEm":  v.AtualizadoEm.UTC().Format(time.RFC3339),
		"_links":        Links(v, p),
	}
}

func nuloSeVazio(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func escreverHAL(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/hal+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(corpo)
}
