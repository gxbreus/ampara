package saga

import (
	"errors"
	"slices"
	"testing"
	"time"
)

var agora = time.Date(2026, 11, 17, 15, 0, 0, 0, time.UTC)

var regras = Regras{Agora: agora, PrazoDecisao: 72 * time.Hour, MaxReenvios: 10}

// sol monta uma solicitação no estado dado, com os passos indicados.
func sol(estado Estado, passos map[Passo]InfoPasso) Solicitacao {
	return Solicitacao{
		ID: "7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17", AdotanteID: "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55",
		AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9", AnimalNome: "Thor", ResponsavelID: "c50a83ab-7db0-41b4-9436-4144c36f97d5",
		Estado: estado, Passos: passos,
	}
}

func pend(bloq bool) InfoPasso { return InfoPasso{Status: Pendente, Bloqueante: bloq} }
func conc() InfoPasso          { return InfoPasso{Status: Concluido} }

func comDesfecho(s Solicitacao, d Estado) Solicitacao { s.Desfecho = d; return s }

// msg resume uma mensagem como "Tipo" ou "Tipo/bloq" para comparar.
func msg(m Mensagem) string {
	if m.Passo != "" && m.Bloqueante {
		return m.Tipo + "/bloq"
	}
	return m.Tipo
}

func TestAs18Transicoes(t *testing.T) {
	casos := []struct {
		n         int
		nome      string
		antes     Solicitacao
		ev        Evento
		estado    Estado
		desfecho  Estado
		mensagens []string
		passos    []AlteracaoPasso
	}{
		{1, "POST cria a solicitação e reserva o animal",
			Solicitacao{ID: "s", AdotanteID: "a", AnimalID: "b"}, Evento{Tipo: EvSolicitacaoCriada},
			Solicitada, "", []string{"ReservarAnimal"}, nil},
		{2, "AnimalReservado valida o perfil",
			sol(Solicitada, map[Passo]InfoPasso{T1: pend(false)}), Evento{Tipo: EvAnimalReservado, ResponsavelID: "r", AnimalNome: "Thor"},
			AnimalReservado, "", []string{"ValidarPerfil"}, []AlteracaoPasso{{T1, Concluir}}},
		{3, "ReservaRecusada encerra sem compensar",
			sol(Solicitada, map[Passo]InfoPasso{T1: pend(false)}), Evento{Tipo: EvReservaRecusada, Motivo: "INDISPONIVEL"},
			RejeitadaIndisponivel, "", []string{"adocao.falhou"}, []AlteracaoPasso{{T1, Concluir}}},
		{4, "timeout do T1 falha com C1 precautória",
			sol(Solicitada, map[Passo]InfoPasso{T1: pend(false)}), Evento{Tipo: EvTimeout, Passo: T1},
			Falhou, "", []string{"LiberarReserva", "adocao.falhou"}, []AlteracaoPasso{{T1, Expirar}}},
		{5, "PerfilValidado aguarda aprovação e publica T3",
			sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvPerfilValidado},
			AguardandoAprovacao, "", []string{"adocao.aguardando_aprovacao"}, []AlteracaoPasso{{T2, Concluir}}},
		{6, "PerfilRecusado compensa só a reserva",
			sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvPerfilRecusado, Motivo: "PERFIL_INCOMPLETO"},
			Compensando, PerfilInvalido, []string{"LiberarReserva/bloq"}, []AlteracaoPasso{{T2, Concluir}}},
		{7, "timeout do T2: C1 bloqueante e C2 precautória",
			sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvTimeout, Passo: T2},
			Compensando, Falhou, []string{"LiberarReserva/bloq", "LiberarVaga"}, []AlteracaoPasso{{T2, Expirar}}},
		{8, "aprovação é o pivô",
			sol(AguardandoAprovacao, map[Passo]InfoPasso{T1: conc(), T2: conc()}), Evento{Tipo: EvAprovacao},
			Aprovada, "", []string{"ConfirmarAdocao", "adocao.aprovada"}, nil},
		{9, "recusa compensa vaga e reserva",
			sol(AguardandoAprovacao, map[Passo]InfoPasso{T1: conc(), T2: conc()}), Evento{Tipo: EvRecusa, Motivo: "sem tela"},
			Compensando, Recusada, []string{"LiberarVaga/bloq", "LiberarReserva/bloq"}, nil},
		{10, "cancelamento compensa vaga e reserva",
			sol(AguardandoAprovacao, map[Passo]InfoPasso{T1: conc(), T2: conc()}), Evento{Tipo: EvCancelamento},
			Compensando, Cancelada, []string{"LiberarVaga/bloq", "LiberarReserva/bloq"}, nil},
		{11, "prazo vencido compensa vaga e reserva",
			sol(AguardandoAprovacao, map[Passo]InfoPasso{T1: conc(), T2: conc()}), Evento{Tipo: EvPrazoExpirado},
			Compensando, Expirada, []string{"LiberarVaga/bloq", "LiberarReserva/bloq"}, nil},
		{12, "última compensação bloqueante grava o desfecho e publica o encerramento",
			comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true), C2: conc()}), Recusada), Evento{Tipo: EvReservaLiberada},
			Recusada, "", []string{"adocao.recusada"}, []AlteracaoPasso{{C1, Concluir}}},
		{13, "timeout de compensação reenvia",
			comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true)}), Recusada), Evento{Tipo: EvTimeout, Passo: C1},
			Compensando, Recusada, nil, []AlteracaoPasso{{C1, Reenviar}}},
		{14, "AdocaoConfirmada registra a adoção",
			sol(Aprovada, map[Passo]InfoPasso{T4: pend(false)}), Evento{Tipo: EvAdocaoConfirmada},
			Aprovada, "", []string{"RegistrarAdocao"}, []AlteracaoPasso{{T4, Concluir}}},
		{15, "AdocaoRegistrada conclui",
			sol(Aprovada, map[Passo]InfoPasso{T4: conc(), T5: pend(false)}), Evento{Tipo: EvAdocaoRegistrada},
			Concluida, "", []string{"adocao.concluida"}, []AlteracaoPasso{{T5, Concluir}}},
		{16, "timeout do T5 reenvia sem compensar",
			sol(Aprovada, map[Passo]InfoPasso{T4: conc(), T5: pend(false)}), Evento{Tipo: EvTimeout, Passo: T5},
			Aprovada, "", nil, []AlteracaoPasso{{T5, Reenviar}}},
		{17, "ConfirmacaoRecusada compensa depois do pivô",
			sol(Aprovada, map[Passo]InfoPasso{T4: pend(false)}), Evento{Tipo: EvConfirmacaoRecusada, Motivo: "NAO_RESERVADO"},
			Compensando, Falhou, []string{"LiberarVaga/bloq", "LiberarReserva/bloq"}, []AlteracaoPasso{{T4, Concluir}}},
		{18, "PerfilValidado tardio reemite LiberarVaga",
			sol(Falhou, map[Passo]InfoPasso{T1: conc(), T2: {Status: Expirado}, C1: conc(), C2: {Status: Pendente}}), Evento{Tipo: EvPerfilValidado},
			Falhou, "", nil, []AlteracaoPasso{{C2, Reemitir}}},
	}

	vistas := map[int]bool{}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			out, err := Transicao(c.antes, c.ev, regras)
			if err != nil {
				t.Fatalf("erro: %v", err)
			}
			if out.Transicao != c.n {
				t.Errorf("transição = %d, esperada %d", out.Transicao, c.n)
			}
			if out.Solicitacao.Estado != c.estado || out.Solicitacao.Desfecho != c.desfecho {
				t.Errorf("estado = %s (desfecho %q), esperado %s (desfecho %q)", out.Solicitacao.Estado, out.Solicitacao.Desfecho, c.estado, c.desfecho)
			}
			var got []string
			for _, m := range out.Mensagens {
				got = append(got, msg(m))
			}
			if !slices.Equal(got, c.mensagens) {
				t.Errorf("mensagens = %v, esperadas %v", got, c.mensagens)
			}
			if !slices.Equal(out.Passos, c.passos) {
				t.Errorf("passos = %v, esperados %v", out.Passos, c.passos)
			}
			vistas[out.Transicao] = true
		})
	}
	for n := 1; n <= 18; n++ {
		if !vistas[n] {
			t.Errorf("transição %d sem caso de teste", n)
		}
	}
}

func TestEncerramentoSoDepoisDaUltimaBloqueante(t *testing.T) {
	s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true), C2: pend(true)}), Expirada)
	out, _ := Transicao(s, Evento{Tipo: EvVagaLiberada}, regras)
	if out.Solicitacao.Estado != Compensando || len(out.Mensagens) != 0 {
		t.Fatalf("com a C1 pendente, o estado deveria ficar em COMPENSANDO sem evento: %+v", out)
	}
}

func TestCompensacaoPrecautoriaNaoSeguraOEstado(t *testing.T) {
	// transição 7: C1 bloqueante + C2 precautória; basta a C1 responder
	s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true), C2: pend(false)}), Falhou)
	s.Motivo = "TIMEOUT_T2"
	out, _ := Transicao(s, Evento{Tipo: EvReservaLiberada}, regras)
	if out.Solicitacao.Estado != Falhou || out.Transicao != 12 {
		t.Fatalf("estado = %s, transição %d", out.Solicitacao.Estado, out.Transicao)
	}
	if out.Mensagens[0].Tipo != "adocao.falhou" || out.Mensagens[0].Payload["motivo"] != "TIMEOUT_T2" {
		t.Fatalf("encerramento inesperado: %+v", out.Mensagens[0])
	}
}

func TestAcaoEmEstadoErradoRetorna409(t *testing.T) {
	for _, e := range []Estado{Solicitada, AnimalReservado, Aprovada, Compensando, Concluida, Recusada} {
		_, err := Transicao(sol(e, nil), Evento{Tipo: EvAprovacao}, regras)
		if !errors.Is(err, ErrEstadoNaoPermite) {
			t.Errorf("aprovar em %s: erro = %v", e, err)
		}
	}
}

func TestCorridaAprovacaoExpiracao(t *testing.T) {
	// a aprovação venceu o lock: a expiração encontra APROVADA e não faz nada
	out, err := Transicao(sol(Aprovada, map[Passo]InfoPasso{T4: pend(false)}), Evento{Tipo: EvPrazoExpirado}, regras)
	if err != nil || !out.Ignorada {
		t.Fatalf("expiração depois da aprovação deveria ser ignorada: %+v %v", out, err)
	}
	// a expiração venceu: a aprovação recebe 409
	if _, err := Transicao(sol(Compensando, nil), Evento{Tipo: EvAprovacao}, regras); !errors.Is(err, ErrEstadoNaoPermite) {
		t.Fatalf("aprovação depois da expiração deveria dar 409: %v", err)
	}
}

func TestRespostaDuplicadaEIgnorada(t *testing.T) {
	out, err := Transicao(sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvAnimalReservado}, regras)
	if err != nil || !out.Ignorada || len(out.Mensagens) != 0 {
		t.Fatalf("AnimalReservado repetido deveria ser ignorado: %+v %v", out, err)
	}
}

func TestRecusaTardiaDaSagaEncerradaEIgnorada(t *testing.T) {
	s := sol(Falhou, map[Passo]InfoPasso{T1: conc(), T2: {Status: Expirado}, C1: conc(), C2: pend(false)})
	out, err := Transicao(s, Evento{Tipo: EvPerfilRecusado, Motivo: "SAGA_ENCERRADA"}, regras)
	if err != nil || !out.Ignorada {
		t.Fatalf("PerfilRecusado {SAGA_ENCERRADA} deveria ser ignorado: %+v %v", out, err)
	}
}

func TestAnimalReservadoTardioReemiteLiberarReserva(t *testing.T) {
	s := sol(Falhou, map[Passo]InfoPasso{T1: {Status: Expirado}, C1: pend(false)})
	out, _ := Transicao(s, Evento{Tipo: EvAnimalReservado}, regras)
	if out.Transicao != 18 || !slices.Equal(out.Passos, []AlteracaoPasso{{C1, Reemitir}}) {
		t.Fatalf("esperava reemitir a C1: %+v", out)
	}
}

func TestTetoDeReenviosEsgotaEPedeIntervencao(t *testing.T) {
	s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: {Status: Pendente, Bloqueante: true, Tentativas: 10}}), Recusada)
	out, _ := Transicao(s, Evento{Tipo: EvTimeout, Passo: C1}, regras)
	if !out.Solicitacao.RequerIntervencao || !slices.Equal(out.Passos, []AlteracaoPasso{{C1, Esgotar}}) {
		t.Fatalf("no teto, deveria esgotar e marcar intervenção: %+v", out)
	}
	if out.Solicitacao.Estado != Compensando {
		t.Fatalf("a solicitação continua em COMPENSANDO: %s", out.Solicitacao.Estado)
	}
}

func TestRespostaDePassoEsgotadoAindaEncerra(t *testing.T) {
	s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: {Status: Esgotado, Bloqueante: true, Tentativas: 10}, C2: conc()}), Recusada)
	s.RequerIntervencao = true
	out, _ := Transicao(s, Evento{Tipo: EvReservaLiberada}, regras)
	if out.Solicitacao.Estado != Recusada || out.Transicao != 12 {
		t.Fatalf("a resposta depois do teto deveria encerrar: %+v", out)
	}
}

func TestTimeoutDepoisDaRespostaEIgnorado(t *testing.T) {
	out, _ := Transicao(sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvTimeout, Passo: T1}, regras)
	if !out.Ignorada {
		t.Fatalf("timeout de passo já concluído deveria ser ignorado: %+v", out)
	}
}

func TestPayloads(t *testing.T) {
	out, _ := Transicao(sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)}), Evento{Tipo: EvPerfilValidado}, regras)
	if got := out.Mensagens[0].Payload["expiraEm"]; got != "2026-11-20T15:00:00Z" {
		t.Errorf("expiraEm = %v, esperado agora + 72h", got)
	}
	if out.Solicitacao.ExpiraEm == nil || !out.Solicitacao.ExpiraEm.Equal(agora.Add(72*time.Hour)) {
		t.Errorf("ExpiraEm não gravado: %v", out.Solicitacao.ExpiraEm)
	}

	// antes da reserva, adocao.falhou leva animalNome e responsavelId nulos
	s := sol(Solicitada, map[Passo]InfoPasso{T1: pend(false)})
	s.AnimalNome, s.ResponsavelID = "", ""
	out, _ = Transicao(s, Evento{Tipo: EvReservaRecusada, Motivo: "INDISPONIVEL"}, regras)
	p := out.Mensagens[0].Payload
	if p["animalNome"] != nil || p["responsavelId"] != nil || p["estadoFinal"] != "REJEITADA_INDISPONIVEL" || p["motivo"] != "INDISPONIVEL" {
		t.Errorf("payload de adocao.falhou inesperado: %v", p)
	}

	// comandos vão para ampara.comandos com a routing key do participante
	out, _ = Transicao(Solicitacao{ID: "s", AdotanteID: "a", AnimalID: "b"}, Evento{Tipo: EvSolicitacaoCriada}, regras)
	m := out.Mensagens[0]
	if m.Exchange != "ampara.comandos" || m.RoutingKey != "animais" || m.Passo != T1 || m.Payload["animalId"] != "b" {
		t.Errorf("ReservarAnimal inesperado: %+v", m)
	}
}

func TestNaoAlteraOEstadoRecebido(t *testing.T) {
	s := sol(AnimalReservado, map[Passo]InfoPasso{T1: conc(), T2: pend(false)})
	_, _ = Transicao(s, Evento{Tipo: EvPerfilValidado}, regras)
	if s.Estado != AnimalReservado || s.Passos[T2].Status != Pendente || s.ExpiraEm != nil {
		t.Fatalf("Transicao alterou o retrato recebido: %+v", s)
	}
}

func TestEventoDeEncerramentoPorDesfecho(t *testing.T) {
	casos := []struct {
		desfecho Estado
		motivo   string
		campos   []string
		tipo     string
	}{
		{Recusada, "sem tela", nil, "adocao.recusada"},
		{Cancelada, "", nil, "adocao.cancelada"},
		{Expirada, "", nil, "adocao.expirada"},
		{PerfilInvalido, "PERFIL_INCOMPLETO", []string{"aceiteTermo"}, "adocao.falhou"},
		{Falhou, "CONFIRMACAO_RECUSADA", nil, "adocao.falhou"},
	}
	for _, c := range casos {
		t.Run(string(c.desfecho), func(t *testing.T) {
			s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true)}), c.desfecho)
			s.Motivo, s.CamposFaltando = c.motivo, c.campos
			out, _ := Transicao(s, Evento{Tipo: EvReservaLiberada}, regras)
			m := out.Mensagens[0]
			if out.Solicitacao.Estado != c.desfecho || m.Tipo != c.tipo || m.RoutingKey != c.tipo || m.Exchange != "ampara.eventos" {
				t.Fatalf("estado %s, mensagem %+v", out.Solicitacao.Estado, m)
			}
			if c.tipo == "adocao.falhou" {
				if m.Payload["estadoFinal"] != string(c.desfecho) || m.Payload["motivo"] != c.motivo {
					t.Errorf("payload: %v", m.Payload)
				}
				if c.campos != nil && !slices.Equal(m.Payload["camposFaltando"].([]string), c.campos) {
					t.Errorf("camposFaltando: %v", m.Payload["camposFaltando"])
				}
			}
			if c.desfecho == Recusada && m.Payload["motivo"] != "sem tela" {
				t.Errorf("motivo da recusa: %v", m.Payload["motivo"])
			}
		})
	}
}

func TestRecusaSemMotivoPublicaMotivoNulo(t *testing.T) {
	out, _ := Transicao(comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true)}), Recusada), Evento{Tipo: EvReservaLiberada}, regras)
	if v, ok := out.Mensagens[0].Payload["motivo"]; !ok || v != nil {
		t.Fatalf("motivo deveria ser null: %v", out.Mensagens[0].Payload)
	}
}

func TestEventosInvalidos(t *testing.T) {
	if _, err := Transicao(sol(Solicitada, nil), Evento{Tipo: EvSolicitacaoCriada}, regras); err == nil {
		t.Error("criar uma solicitação que já existe deveria falhar")
	}
	if _, err := Transicao(sol(Solicitada, nil), Evento{Tipo: "Inventado"}, regras); err == nil {
		t.Error("evento desconhecido deveria falhar")
	}
	if _, err := Transicao(sol(AguardandoAprovacao, map[Passo]InfoPasso{T2: pend(false)}), Evento{Tipo: EvPerfilRecusado}, regras); err == nil {
		t.Error("resposta fora de lugar deveria falhar")
	}
}

func TestRetomadaDosPassosEsgotados(t *testing.T) {
	s := comDesfecho(sol(Compensando, map[Passo]InfoPasso{
		C1: {Status: Esgotado, Bloqueante: true, Tentativas: 10},
		C2: {Status: Concluido, Bloqueante: true},
	}), Recusada)
	s.RequerIntervencao = true
	out, err := Transicao(s, Evento{Tipo: EvRetomada}, regras)
	if err != nil {
		t.Fatal(err)
	}
	if out.Solicitacao.RequerIntervencao || out.Solicitacao.Estado != Compensando || out.Transicao != 13 {
		t.Fatalf("retomada: %+v", out.Solicitacao)
	}
	if !slices.Equal(out.Passos, []AlteracaoPasso{{C1, Retomar}}) || len(out.Mensagens) != 0 {
		t.Fatalf("só a C1 esgotada é retomada, sem mensagem nova (mesmo messageId): %+v", out)
	}

	// depois do pivô, T4 ou T5 esgotado também pode ser retomado
	s = sol(Aprovada, map[Passo]InfoPasso{T4: {Status: Esgotado, Tentativas: 10}})
	s.RequerIntervencao = true
	if out, err := Transicao(s, Evento{Tipo: EvRetomada}, regras); err != nil || out.Transicao != 16 {
		t.Fatalf("retomada do T4: %+v %v", out, err)
	}
}

func TestRetomadaSemPassoEsgotadoDa409(t *testing.T) {
	for _, s := range []Solicitacao{
		sol(AguardandoAprovacao, map[Passo]InfoPasso{T1: conc(), T2: conc()}),
		comDesfecho(sol(Compensando, map[Passo]InfoPasso{C1: pend(true)}), Recusada),
	} {
		if _, err := Transicao(s, Evento{Tipo: EvRetomada}, regras); !errors.Is(err, ErrEstadoNaoPermite) {
			t.Errorf("%s: erro %v", s.Estado, err)
		}
	}
}
