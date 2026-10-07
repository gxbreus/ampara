// Package saga contém a máquina de estados da SAGA de adoção (docs/saga.md).
//
// Toda regra de negócio da orquestração está em Transicao, uma função pura: recebe o
// retrato da solicitação e um evento, e devolve o novo retrato e os efeitos (passos a
// abrir ou concluir, mensagens para o outbox, reenvios). O resto do serviço só persiste
// esses efeitos numa transação e publica pelo outbox.
package saga

import "time"

// Estado da solicitação. Os nomes são os de docs/saga.md e do contrato adocao.v1.yaml.
type Estado string

const (
	Solicitada            Estado = "SOLICITADA"
	AnimalReservado       Estado = "ANIMAL_RESERVADO"
	AguardandoAprovacao   Estado = "AGUARDANDO_APROVACAO"
	Aprovada              Estado = "APROVADA"
	Compensando           Estado = "COMPENSANDO"
	Concluida             Estado = "CONCLUIDA"
	RejeitadaIndisponivel Estado = "REJEITADA_INDISPONIVEL"
	PerfilInvalido        Estado = "PERFIL_INVALIDO"
	Recusada              Estado = "RECUSADA"
	Cancelada             Estado = "CANCELADA"
	Expirada              Estado = "EXPIRADA"
	Falhou                Estado = "FALHOU"
)

// Final diz se o estado encerra a SAGA.
func (e Estado) Final() bool {
	switch e {
	case Concluida, RejeitadaIndisponivel, PerfilInvalido, Recusada, Cancelada, Expirada, Falhou:
		return true
	}
	return false
}

// Passo da SAGA que espera uma resposta. T3 e T6 são só eventos e não aparecem aqui.
type Passo string

const (
	T1 Passo = "T1" // ReservarAnimal
	T2 Passo = "T2" // ValidarPerfil
	T4 Passo = "T4" // ConfirmarAdocao
	T5 Passo = "T5" // RegistrarAdocao
	C1 Passo = "C1" // LiberarReserva
	C2 Passo = "C2" // LiberarVaga
)

// StatusPasso é o andamento de um passo em saga_passos.
type StatusPasso string

const (
	Pendente  StatusPasso = "PENDENTE"
	Concluido StatusPasso = "CONCLUIDO"
	Expirado  StatusPasso = "EXPIRADO" // deu timeout e não será reenviado
	Esgotado  StatusPasso = "ESGOTADO" // atingiu o teto de reenvios; espera intervenção (#86)
)

// InfoPasso é o que a máquina precisa saber de cada passo.
type InfoPasso struct {
	Status StatusPasso
	// Bloqueante: a compensação desfaz um passo confirmado e segura o estado final até
	// responder. Precautória (false): desfaz um passo de resultado incerto, sai pelo
	// outbox mas não segura nada e não é reenviada.
	Bloqueante bool
	Tentativas int
}

// Solicitacao é o retrato que a máquina recebe e devolve.
type Solicitacao struct {
	ID                string
	AdotanteID        string
	AnimalID          string
	AnimalNome        string // conhecido a partir de AnimalReservado
	ResponsavelID     string // conhecido a partir de AnimalReservado
	Estado            Estado // vazio antes da criação
	Desfecho          Estado // preenchido em COMPENSANDO: o estado final que virá
	Motivo            string // motivo de recusa ou de falha
	CamposFaltando    []string
	ExpiraEm          *time.Time
	RequerIntervencao bool
	Passos            map[Passo]InfoPasso
}

// TipoEvento é o gatilho de uma transição.
type TipoEvento string

const (
	// ação do adotante
	EvSolicitacaoCriada TipoEvento = "SolicitacaoCriada"
	EvCancelamento      TipoEvento = "Cancelamento"
	// ações do responsável
	EvAprovacao TipoEvento = "Aprovacao"
	EvRecusa    TipoEvento = "Recusa"
	// sistema
	EvPrazoExpirado TipoEvento = "PrazoExpirado"
	EvTimeout       TipoEvento = "Timeout"
	// respostas dos participantes (docs/contratos/eventos.md)
	EvAnimalReservado     TipoEvento = "AnimalReservado"
	EvReservaRecusada     TipoEvento = "ReservaRecusada"
	EvReservaLiberada     TipoEvento = "ReservaLiberada"
	EvAdocaoConfirmada    TipoEvento = "AdocaoConfirmada"
	EvConfirmacaoRecusada TipoEvento = "ConfirmacaoRecusada"
	EvPerfilValidado      TipoEvento = "PerfilValidado"
	EvPerfilRecusado      TipoEvento = "PerfilRecusado"
	EvVagaLiberada        TipoEvento = "VagaLiberada"
	EvAdocaoRegistrada    TipoEvento = "AdocaoRegistrada"
)

// Evento que dispara a transição, com os dados do payload que interessam à máquina.
type Evento struct {
	Tipo           TipoEvento
	Passo          Passo // só em Timeout
	Motivo         string
	CamposFaltando []string
	ResponsavelID  string // AnimalReservado
	AnimalNome     string // AnimalReservado
}

// Regras são os parâmetros da máquina; Agora entra aqui para a função continuar pura.
type Regras struct {
	Agora        time.Time
	PrazoDecisao time.Duration // ADOCAO_PRAZO_EXPIRACAO
	MaxReenvios  int           // ADOCAO_MAX_REENVIOS_COMPENSACAO
}

// Mensagem a gravar no outbox. Quando Passo não é vazio, é um comando que abre esse passo
// em saga_passos e terá o messageId reaproveitado em todo reenvio.
type Mensagem struct {
	Tipo       string
	Exchange   string
	RoutingKey string
	Passo      Passo
	Bloqueante bool
	Payload    map[string]any
}

// AcaoPasso é o que acontece com um passo depois da transição.
type AcaoPasso string

const (
	Concluir AcaoPasso = "CONCLUIR"
	Expirar  AcaoPasso = "EXPIRAR"
	Reenviar AcaoPasso = "REENVIAR" // mesmo messageId, mais uma tentativa
	Esgotar  AcaoPasso = "ESGOTAR"
	Reemitir AcaoPasso = "REEMITIR" // compensação reemitida por resposta tardia (transição 18)
)

// AlteracaoPasso aplica uma ação a um passo já aberto.
type AlteracaoPasso struct {
	Passo Passo
	Acao  AcaoPasso
}

// Saida da transição.
type Saida struct {
	Solicitacao Solicitacao // novo retrato
	Transicao   int         // número da transição em docs/saga.md; 0 quando nada muda
	Mensagens   []Mensagem
	Passos      []AlteracaoPasso
	// Ignorada: o evento não muda nada (duplicado, tardio sem efeito, corrida perdida).
	Ignorada bool
}
