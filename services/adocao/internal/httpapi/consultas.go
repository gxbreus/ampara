package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/gxbreus/ampara/services/adocao/internal/auth"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

const admin = "ADMIN"

// obter: GET /v1/solicitacoes/{id}. Só o adotante, o responsável e ADMIN veem.
func (h *handlerSolicitacoes) obter(w http.ResponseWriter, r *http.Request) {
	u, v, ok := h.carregarAutorizado(w, r)
	if !ok {
		return
	}
	escreverHAL(w, http.StatusOK, representar(v, papel(v, u)))
}

// carregarAutorizado autentica, lê a solicitação e confere se quem pede é parte dela.
func (h *handlerSolicitacoes) carregarAutorizado(w http.ResponseWriter, r *http.Request) (auth.Usuario, repositorio.Visao, bool) {
	u, ok := h.autenticar(w, r)
	if !ok {
		return u, repositorio.Visao{}, false
	}
	v, err := h.repo.Obter(r.Context(), r.PathValue("id"))
	if errors.Is(err, repositorio.ErrNaoEncontrada) {
		naoEncontrada(w)
		return u, v, false
	}
	if err != nil {
		h.erroInterno(w, r, "obter solicitação", err)
		return u, v, false
	}
	if papel(v, u) == Outro && u.Role != admin {
		semPermissao(w, "Só o adotante e o responsável pelo animal podem ver esta solicitação.")
		return u, v, false
	}
	return u, v, true
}

// acao trata aprovação, recusa e cancelamento. Todas respondem 202: disparam passos
// assíncronos da SAGA. O lock e a regra de estado ficam no repositório e na máquina, então
// o duplo clique na aprovação encontra APROVADA e recebe 409, sem um segundo ConfirmarAdocao.
func (h *handlerSolicitacoes) acao(tipo saga.TipoEvento, exigido Papel) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, v, ok := h.carregarAutorizado(w, r)
		if !ok {
			return
		}
		if papel(v, u) != exigido {
			quem := map[Papel]string{Responsavel: "o responsável pelo animal", Adotante: "o adotante que fez a solicitação"}[exigido]
			semPermissao(w, "Só "+quem+" pode fazer esta ação.")
			return
		}
		ev := saga.Evento{Tipo: tipo}
		if tipo == saga.EvRecusa {
			motivo, ok := lerMotivo(w, r)
			if !ok {
				return
			}
			ev.Motivo = motivo
		}

		_, err := h.repo.Aplicar(r.Context(), v.ID, ev)
		if errors.Is(err, saga.ErrEstadoNaoPermite) {
			escreverProblema(w, http.StatusConflict, "estado-nao-permite-acao", "Estado não permite a ação",
				"A solicitação está em "+string(v.Estado)+"; esta ação só é possível em AGUARDANDO_APROVACAO.")
			return
		}
		if err != nil {
			h.erroInterno(w, r, "aplicar ação", err)
			return
		}
		h.log.InfoContext(r.Context(), "ação registrada", "correlationId", CorrelationID(r.Context()), "sagaId", v.ID, "acao", string(tipo))
		depois, err := h.repo.Obter(r.Context(), v.ID)
		if err != nil {
			h.erroInterno(w, r, "obter solicitação", err)
			return
		}
		escreverHAL(w, http.StatusAccepted, representar(depois, papel(depois, u)))
	}
}

func lerMotivo(w http.ResponseWriter, r *http.Request) (string, bool) {
	corpo, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil {
		invalido(w, "Corpo grande demais.")
		return "", false
	}
	if len(corpo) == 0 {
		return "", true // o motivo é opcional
	}
	var recusa struct {
		Motivo string `json:"motivo"`
	}
	dec := json.NewDecoder(bytes.NewReader(corpo))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&recusa); err != nil || len([]rune(recusa.Motivo)) > 500 {
		invalido(w, "O corpo aceita só motivo, com até 500 caracteres.")
		return "", false
	}
	return recusa.Motivo, true
}

// listar: GET /v1/solicitacoes. Exige pelo menos um filtro; adotanteId ou responsavelId
// precisa ser o sub do token, exceto para ADMIN.
func (h *handlerSolicitacoes) listar(w http.ResponseWriter, r *http.Request) {
	u, ok := h.autenticar(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f := repositorio.Filtro{AdotanteID: q.Get("adotanteId"), AnimalID: q.Get("animalId"), ResponsavelID: q.Get("responsavelId"),
		Estado: saga.Estado(q.Get("estado")), Cursor: q.Get("cursor"), Limite: 20}
	if f.AdotanteID == "" && f.AnimalID == "" && f.ResponsavelID == "" && f.Estado == "" && q.Get("ativa") == "" {
		invalido(w, "Informe pelo menos um filtro.")
		return
	}
	if f.Estado != "" && !estadoValido(f.Estado) {
		invalido(w, "estado desconhecido.")
		return
	}
	if a := q.Get("ativa"); a != "" {
		b, err := strconv.ParseBool(a)
		if err != nil {
			invalido(w, "ativa deve ser true ou false.")
			return
		}
		f.Ativa = &b
	}
	if l := q.Get("limite"); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 1 || n > 100 {
			invalido(w, "limite deve estar entre 1 e 100.")
			return
		}
		f.Limite = n
	}
	if u.Role != admin && f.AdotanteID != u.Sub && f.ResponsavelID != u.Sub {
		semPermissao(w, "Filtre por adotanteId ou responsavelId igual ao seu usuário.")
		return
	}

	itens, proximo, err := h.repo.Listar(r.Context(), f)
	if errors.Is(err, repositorio.ErrCursorInvalido) {
		invalido(w, "cursor inválido: use o valor de _links.next.")
		return
	}
	if err != nil {
		h.erroInterno(w, r, "listar solicitações", err)
		return
	}
	solicitacoes := make([]map[string]any, 0, len(itens))
	for _, v := range itens {
		solicitacoes = append(solicitacoes, representar(v, papel(v, u)))
	}
	links := map[string]link{"self": {Href: r.URL.RequestURI()}}
	if proximo != "" {
		q.Set("cursor", proximo)
		links["next"] = link{Href: "/v1/solicitacoes?" + q.Encode()}
	}
	escreverHAL(w, http.StatusOK, map[string]any{"_embedded": map[string]any{"solicitacoes": solicitacoes}, "_links": links})
}

// resumir: GET /v1/solicitacoes/resumo?responsavelId=, para o painel da ONG.
func (h *handlerSolicitacoes) resumir(w http.ResponseWriter, r *http.Request) {
	u, ok := h.autenticar(w, r)
	if !ok {
		return
	}
	responsavel := r.URL.Query().Get("responsavelId")
	if responsavel == "" {
		invalido(w, "Informe responsavelId.")
		return
	}
	if u.Role != admin && responsavel != u.Sub {
		semPermissao(w, "O resumo é só das suas solicitações.")
		return
	}
	res, err := h.repo.Resumir(r.Context(), responsavel)
	if err != nil {
		h.erroInterno(w, r, "resumir solicitações", err)
		return
	}
	escreverJSON(w, http.StatusOK, map[string]any{
		"porEstado": res.PorEstado, "ativasPorAnimal": res.AtivasPorAnimal, "concluidasNoMes": res.ConcluidasNoMes,
	})
}

// historico: GET /v1/solicitacoes/{id}/historico, a linha do tempo (HU-14).
func (h *handlerSolicitacoes) historico(w http.ResponseWriter, r *http.Request) {
	_, v, ok := h.carregarAutorizado(w, r)
	if !ok {
		return
	}
	itens, err := h.repo.Historico(r.Context(), v.ID)
	if err != nil {
		h.erroInterno(w, r, "ler histórico", err)
		return
	}
	saida := make([]map[string]any, 0, len(itens))
	for _, i := range itens {
		saida = append(saida, map[string]any{
			"de": nuloSeVazio(i.De), "para": i.Para, "evento": i.Evento, "passo": nuloSeVazio(i.Passo),
			"em": i.Em.UTC().Format(time.RFC3339Nano),
		})
	}
	self := "/v1/solicitacoes/" + url.PathEscape(v.ID)
	escreverHAL(w, http.StatusOK, map[string]any{
		"itens":  saida,
		"_links": map[string]link{"self": {Href: self + "/historico"}, "solicitacao": {Href: self}},
	})
}

func estadoValido(e saga.Estado) bool {
	switch e {
	case saga.Solicitada, saga.AnimalReservado, saga.AguardandoAprovacao, saga.Aprovada, saga.Compensando, saga.Concluida,
		saga.RejeitadaIndisponivel, saga.PerfilInvalido, saga.Recusada, saga.Cancelada, saga.Expirada, saga.Falhou:
		return true
	}
	return false
}

func (h *handlerSolicitacoes) erroInterno(w http.ResponseWriter, r *http.Request, onde string, err error) {
	h.log.ErrorContext(r.Context(), onde, "correlationId", CorrelationID(r.Context()), "erro", err.Error())
	escreverProblema(w, http.StatusInternalServerError, "erro-interno", "Erro interno", "Não foi possível concluir a operação.")
}

func naoEncontrada(w http.ResponseWriter) {
	escreverProblema(w, http.StatusNotFound, "solicitacao-nao-encontrada", "Solicitação não encontrada", "Não existe solicitação com este identificador.")
}

func semPermissao(w http.ResponseWriter, detalhe string) {
	escreverProblema(w, http.StatusForbidden, "sem-permissao", "Sem permissão", detalhe)
}

func invalido(w http.ResponseWriter, detalhe string) {
	escreverProblema(w, http.StatusUnprocessableEntity, "validacao", "Dados inválidos", detalhe)
}
