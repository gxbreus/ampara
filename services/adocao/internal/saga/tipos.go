// Package saga traz os estados da SAGA de adoção como a Adoção os mostra. A máquina de
// estados é do Orquestrador (ADR-008); aqui só chegam os estados, em saga.transicao.
package saga

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

// Valido diz se o estado existe.
func (e Estado) Valido() bool {
	switch e {
	case Solicitada, AnimalReservado, AguardandoAprovacao, Aprovada, Compensando:
		return true
	}
	return e.Final()
}

// Decisao é o que o responsável (aprovar ou recusar) ou o adotante (cancelar) decide em
// AGUARDANDO_APROVACAO. Vai ao Orquestrador em solicitacao.decidida.
type Decisao string

const (
	Aprovar  Decisao = "APROVADA"
	Recusar  Decisao = "RECUSADA"
	Cancelar Decisao = "CANCELADA"
)
