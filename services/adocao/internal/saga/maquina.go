package saga

import (
	"errors"
	"fmt"
	"maps"
	"slices"
)

// ErrEstadoNaoPermite: a ação não é válida no estado atual (a API responde 409).
var ErrEstadoNaoPermite = errors.New("o estado atual não permite a ação")

const (
	exComandos = "ampara.comandos"
	exEventos  = "ampara.eventos"
)

// Transicao aplica o evento à solicitação. É pura: não lê relógio, banco nem broker.
// Os números nos comentários são os da tabela de transições de docs/saga.md.
func Transicao(s Solicitacao, ev Evento, r Regras) (Saida, error) {
	s = copiar(s)
	out := Saida{Solicitacao: s}

	switch ev.Tipo {
	case EvSolicitacaoCriada:
		if s.Estado != "" {
			return out, fmt.Errorf("solicitação %s já existe", s.ID)
		}
		// 1. POST /v1/solicitacoes -> SOLICITADA, emite ReservarAnimal (T1)
		out.Solicitacao.Estado = Solicitada
		out.Transicao = 1
		out.Mensagens = append(out.Mensagens, reservarAnimal(s))
		return out, nil

	case EvAprovacao, EvRecusa, EvCancelamento:
		return acaoHumana(out, ev)

	case EvPrazoExpirado:
		if s.Estado != AguardandoAprovacao {
			// a aprovação, a recusa ou o cancelamento venceram a corrida (FOR UPDATE)
			return ignorar(out), nil
		}
		// 11. prazo vencido -> COMPENSANDO (EXPIRADA), C2 + C1 bloqueantes
		return compensar(out, 11, Expirada, "", true, true), nil

	case EvTimeout:
		return timeout(out, ev.Passo, r)
	}

	return resposta(out, ev, r)
}

func acaoHumana(out Saida, ev Evento) (Saida, error) {
	s := out.Solicitacao
	if s.Estado != AguardandoAprovacao {
		return out, ErrEstadoNaoPermite
	}
	switch ev.Tipo {
	case EvAprovacao:
		// 8. aprovação (pivô) -> APROVADA, emite ConfirmarAdocao (T4) + adocao.aprovada
		out.Solicitacao.Estado = Aprovada
		out.Transicao = 8
		out.Mensagens = append(out.Mensagens, confirmarAdocao(s), evento("adocao.aprovada", base(s)))
		return out, nil
	case EvRecusa:
		// 9. recusa -> COMPENSANDO (RECUSADA), C2 + C1 bloqueantes
		return compensar(out, 9, Recusada, ev.Motivo, true, true), nil
	default:
		// 10. cancelamento -> COMPENSANDO (CANCELADA), C2 + C1 bloqueantes
		return compensar(out, 10, Cancelada, "", true, true), nil
	}
}

func timeout(out Saida, passo Passo, r Regras) (Saida, error) {
	s := out.Solicitacao
	info, ok := s.Passos[passo]
	if !ok || info.Status != Pendente {
		return ignorar(out), nil // a resposta chegou antes do verificador
	}

	switch {
	case s.Estado == Solicitada && passo == T1:
		// 4. timeout do T1 -> FALHOU, C1 precautória + adocao.falhou
		out.Passos = append(out.Passos, AlteracaoPasso{T1, Expirar})
		out.Solicitacao.Estado = Falhou
		out.Solicitacao.Motivo = "TIMEOUT_T1"
		out.Transicao = 4
		out.Mensagens = append(out.Mensagens, liberarReserva(s, false), falhou(out.Solicitacao))
		return out, nil

	case s.Estado == AnimalReservado && passo == T2:
		// 7. timeout do T2 -> COMPENSANDO (FALHOU), C1 bloqueante + C2 precautória
		out.Passos = append(out.Passos, AlteracaoPasso{T2, Expirar})
		out = compensar(out, 7, Falhou, "TIMEOUT_T2", false, true)
		// a reserva foi confirmada (C1 bloqueante); a vaga é incerta, porque o T2 deu timeout
		out.Mensagens = append(out.Mensagens, liberarVaga(s, false))
		return out, nil

	case s.Estado == Compensando && (passo == C1 || passo == C2) && info.Bloqueante,
		s.Estado == Aprovada && (passo == T4 || passo == T5):
		// 13. timeout de compensação bloqueante / 16. timeout de T4 ou T5:
		// reenvia com o mesmo messageId até o teto; no teto, espera intervenção (#86)
		numero := 13
		if s.Estado == Aprovada {
			numero = 16
		}
		out.Transicao = numero
		if info.Tentativas >= r.MaxReenvios {
			out.Passos = append(out.Passos, AlteracaoPasso{passo, Esgotar})
			out.Solicitacao.RequerIntervencao = true
			return out, nil
		}
		out.Passos = append(out.Passos, AlteracaoPasso{passo, Reenviar})
		return out, nil
	}

	// timeout de uma compensação precautória: não é acompanhada
	return ignorar(out), nil
}

func resposta(out Saida, ev Evento, r Regras) (Saida, error) {
	s := out.Solicitacao
	passo, ok := passoDaResposta[ev.Tipo]
	if !ok {
		return out, fmt.Errorf("evento desconhecido: %s", ev.Tipo)
	}
	info, existe := s.Passos[passo]
	// um passo esgotado (#86) ainda aceita a resposta: é o participante voltando
	pendente := existe && aberto(info.Status)

	// 18. resposta positiva tardia em estado final ou em COMPENSANDO: o efeito aconteceu
	// depois do timeout, então a compensação correspondente é reemitida
	if (s.Estado.Final() || s.Estado == Compensando) && !pendente {
		switch ev.Tipo {
		case EvAnimalReservado:
			out.Transicao = 18
			out.Passos = append(out.Passos, AlteracaoPasso{C1, Reemitir})
			if _, temC1 := s.Passos[C1]; !temC1 {
				out.Passos = nil
				out.Mensagens = append(out.Mensagens, liberarReserva(s, false))
			}
			return out, nil
		case EvPerfilValidado:
			out.Transicao = 18
			out.Passos = append(out.Passos, AlteracaoPasso{C2, Reemitir})
			if _, temC2 := s.Passos[C2]; !temC2 {
				out.Passos = nil
				out.Mensagens = append(out.Mensagens, liberarVaga(s, false))
			}
			return out, nil
		}
	}

	if !pendente {
		// resposta repetida com outro messageId, ou recusa tardia (SAGA_ENCERRADA)
		return ignorar(out), nil
	}

	switch {
	case s.Estado == Solicitada && ev.Tipo == EvAnimalReservado:
		// 2. AnimalReservado -> ANIMAL_RESERVADO, emite ValidarPerfil (T2)
		out.Passos = append(out.Passos, AlteracaoPasso{T1, Concluir})
		out.Solicitacao.Estado = AnimalReservado
		out.Solicitacao.ResponsavelID = ev.ResponsavelID
		out.Solicitacao.AnimalNome = ev.AnimalNome
		out.Transicao = 2
		out.Mensagens = append(out.Mensagens, validarPerfil(out.Solicitacao))
		return out, nil

	case s.Estado == Solicitada && ev.Tipo == EvReservaRecusada:
		// 3. ReservaRecusada -> REJEITADA_INDISPONIVEL, sem compensação
		out.Passos = append(out.Passos, AlteracaoPasso{T1, Concluir})
		out.Solicitacao.Estado = RejeitadaIndisponivel
		out.Solicitacao.Motivo = ev.Motivo
		out.Transicao = 3
		out.Mensagens = append(out.Mensagens, falhou(out.Solicitacao))
		return out, nil

	case s.Estado == AnimalReservado && ev.Tipo == EvPerfilValidado:
		// 5. PerfilValidado -> AGUARDANDO_APROVACAO (grava expira_em), publica T3
		out.Passos = append(out.Passos, AlteracaoPasso{T2, Concluir})
		expira := r.Agora.Add(r.PrazoDecisao)
		out.Solicitacao.Estado = AguardandoAprovacao
		out.Solicitacao.ExpiraEm = &expira
		out.Transicao = 5
		payload := base(out.Solicitacao)
		payload["expiraEm"] = expira.UTC().Format("2006-01-02T15:04:05Z07:00")
		out.Mensagens = append(out.Mensagens, evento("adocao.aguardando_aprovacao", payload))
		return out, nil

	case s.Estado == AnimalReservado && ev.Tipo == EvPerfilRecusado:
		// 6. PerfilRecusado -> COMPENSANDO (PERFIL_INVALIDO), C1 bloqueante; a vaga não foi ocupada
		out.Passos = append(out.Passos, AlteracaoPasso{T2, Concluir})
		out.Solicitacao.CamposFaltando = slices.Clone(ev.CamposFaltando)
		return compensar(out, 6, PerfilInvalido, ev.Motivo, false, true), nil

	case s.Estado == Aprovada && ev.Tipo == EvAdocaoConfirmada:
		// 14. AdocaoConfirmada -> APROVADA (passo T5), emite RegistrarAdocao
		out.Passos = append(out.Passos, AlteracaoPasso{T4, Concluir})
		out.Transicao = 14
		out.Mensagens = append(out.Mensagens, registrarAdocao(s))
		return out, nil

	case s.Estado == Aprovada && ev.Tipo == EvAdocaoRegistrada:
		// 15. AdocaoRegistrada -> CONCLUIDA, publica adocao.concluida (T6)
		out.Passos = append(out.Passos, AlteracaoPasso{T5, Concluir})
		out.Solicitacao.Estado = Concluida
		out.Transicao = 15
		out.Mensagens = append(out.Mensagens, evento("adocao.concluida", base(s)))
		return out, nil

	case s.Estado == Aprovada && ev.Tipo == EvConfirmacaoRecusada:
		// 17. ConfirmacaoRecusada (invariante violada) -> COMPENSANDO (FALHOU), C2 + C1.
		// A C1 é condicional no participante: Animais só libera a reserva se ainda for
		// desta SAGA, e responde ReservaLiberada de qualquer forma.
		out.Passos = append(out.Passos, AlteracaoPasso{T4, Concluir})
		return compensar(out, 17, Falhou, "CONFIRMACAO_RECUSADA", true, true), nil

	case s.Estado == Compensando && (ev.Tipo == EvReservaLiberada || ev.Tipo == EvVagaLiberada):
		out.Passos = append(out.Passos, AlteracaoPasso{passo, Concluir})
		if !info.Bloqueante || aindaBloqueia(s, passo) {
			// resposta de precautória, ou ainda falta outra bloqueante: o estado fica
			return out, nil
		}
		// 12. última compensação bloqueante -> o desfecho; só agora sai o encerramento
		out.Solicitacao.Estado = s.Desfecho
		out.Solicitacao.Desfecho = ""
		out.Transicao = 12
		out.Mensagens = append(out.Mensagens, encerramento(out.Solicitacao))
		return out, nil
	}

	// resposta de precautória depois do estado final: só fecha o passo
	if ev.Tipo == EvReservaLiberada || ev.Tipo == EvVagaLiberada {
		out.Passos = append(out.Passos, AlteracaoPasso{passo, Concluir})
		return out, nil
	}
	return out, fmt.Errorf("%s não é esperado em %s", ev.Tipo, s.Estado)
}

var passoDaResposta = map[TipoEvento]Passo{
	EvAnimalReservado:     T1,
	EvReservaRecusada:     T1,
	EvPerfilValidado:      T2,
	EvPerfilRecusado:      T2,
	EvAdocaoConfirmada:    T4,
	EvConfirmacaoRecusada: T4,
	EvAdocaoRegistrada:    T5,
	EvReservaLiberada:     C1,
	EvVagaLiberada:        C2,
}

// compensar leva a solicitação a COMPENSANDO com o desfecho dado e emite as compensações.
// A ordem das mensagens é C2 (vaga) e depois C1 (reserva), como em docs/saga.md.
func compensar(out Saida, numero int, desfecho Estado, motivo string, vaga, reserva bool) Saida {
	s := out.Solicitacao
	out.Solicitacao.Estado = Compensando
	out.Solicitacao.Desfecho = desfecho
	if motivo != "" {
		out.Solicitacao.Motivo = motivo
	}
	out.Transicao = numero
	if vaga {
		out.Mensagens = append(out.Mensagens, liberarVaga(s, true))
	}
	if reserva {
		out.Mensagens = append(out.Mensagens, liberarReserva(s, true))
	}
	return out
}

// aindaBloqueia diz se, além do passo que acabou de responder, há outra compensação
// bloqueante pendente.
func aindaBloqueia(s Solicitacao, respondido Passo) bool {
	for p, info := range s.Passos {
		if p != respondido && (p == C1 || p == C2) && info.Bloqueante && aberto(info.Status) {
			return true
		}
	}
	return false
}

// aberto diz se o passo ainda espera resposta.
func aberto(st StatusPasso) bool { return st == Pendente || st == Esgotado }

func ignorar(out Saida) Saida {
	out.Ignorada = true
	out.Transicao = 0
	return out
}

func copiar(s Solicitacao) Solicitacao {
	s.Passos = maps.Clone(s.Passos)
	if s.Passos == nil {
		s.Passos = map[Passo]InfoPasso{}
	}
	s.CamposFaltando = slices.Clone(s.CamposFaltando)
	return s
}

// ---- mensagens (nomes e payloads de docs/contratos/eventos.md)

func comando(tipo, destino string, passo Passo, bloqueante bool, payload map[string]any) Mensagem {
	return Mensagem{Tipo: tipo, Exchange: exComandos, RoutingKey: destino, Passo: passo, Bloqueante: bloqueante, Payload: payload}
}

func reservarAnimal(s Solicitacao) Mensagem {
	return comando("ReservarAnimal", "animais", T1, false, map[string]any{"animalId": s.AnimalID})
}

func validarPerfil(s Solicitacao) Mensagem {
	return comando("ValidarPerfil", "identidade", T2, false, map[string]any{"adotanteId": s.AdotanteID})
}

func confirmarAdocao(s Solicitacao) Mensagem {
	return comando("ConfirmarAdocao", "animais", T4, false, map[string]any{"animalId": s.AnimalID, "adotanteId": s.AdotanteID})
}

func registrarAdocao(s Solicitacao) Mensagem {
	return comando("RegistrarAdocao", "identidade", T5, false, map[string]any{"adotanteId": s.AdotanteID, "animalId": s.AnimalID})
}

func liberarReserva(s Solicitacao, bloqueante bool) Mensagem {
	return comando("LiberarReserva", "animais", C1, bloqueante, map[string]any{"animalId": s.AnimalID})
}

func liberarVaga(s Solicitacao, bloqueante bool) Mensagem {
	return comando("LiberarVaga", "identidade", C2, bloqueante, map[string]any{"adotanteId": s.AdotanteID})
}

func evento(tipo string, payload map[string]any) Mensagem {
	return Mensagem{Tipo: tipo, Exchange: exEventos, RoutingKey: tipo, Payload: payload}
}

// base é o payload comum dos eventos adocao.*.
func base(s Solicitacao) map[string]any {
	return map[string]any{
		"solicitacaoId": s.ID,
		"animalId":      s.AnimalID,
		"animalNome":    s.AnimalNome,
		"adotanteId":    s.AdotanteID,
		"responsavelId": s.ResponsavelID,
	}
}

// falhou monta adocao.falhou; antes da reserva, animalNome e responsavelId vão null.
func falhou(s Solicitacao) Mensagem {
	p := base(s)
	if s.AnimalNome == "" {
		p["animalNome"] = nil
	}
	if s.ResponsavelID == "" {
		p["responsavelId"] = nil
	}
	p["estadoFinal"] = string(s.Estado)
	p["motivo"] = s.Motivo
	if len(s.CamposFaltando) > 0 {
		p["camposFaltando"] = slices.Clone(s.CamposFaltando)
	}
	return evento("adocao.falhou", p)
}

// encerramento é o evento da transição 12, conforme o estado final.
func encerramento(s Solicitacao) Mensagem {
	switch s.Estado {
	case Recusada:
		p := base(s)
		if s.Motivo == "" {
			p["motivo"] = nil
		} else {
			p["motivo"] = s.Motivo
		}
		return evento("adocao.recusada", p)
	case Cancelada:
		return evento("adocao.cancelada", base(s))
	case Expirada:
		return evento("adocao.expirada", base(s))
	default: // PERFIL_INVALIDO e FALHOU
		return falhou(s)
	}
}
