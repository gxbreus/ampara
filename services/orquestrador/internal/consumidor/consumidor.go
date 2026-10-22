// Package consumidor processa as mensagens que movem a SAGA, em duas filas:
//
//   - orquestrador.respostas: respostas dos participantes (Animais e Identidade);
//   - orquestrador.solicitacoes: solicitacao.criada, solicitacao.decidida e
//     solicitacao.retomada, publicadas pela Adoção (ADR-008).
//
// Para cada mensagem: grava o messageId na inbox e aplica a transição numa transação só,
// e só depois do commit faz o ack. Se o processo cair antes do ack, o RabbitMQ entrega de
// novo, a inbox reconhece o messageId e a mensagem vira ack sem efeito.
package consumidor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/gxbreus/ampara/services/orquestrador/internal/repositorio"
	"github.com/gxbreus/ampara/services/orquestrador/internal/saga"
)

const (
	FilaRespostas    = "orquestrador.respostas"
	FilaSolicitacoes = "orquestrador.solicitacoes"
)

// Destino diz o que fazer com a mensagem depois de processada.
type Destino int

const (
	Ack      Destino = iota // processada (ou repetida)
	ParaDLQ                 // inválida: nack sem requeue, vai direto para a DLQ
	Devolver                // erro temporário: nack com requeue (até o x-delivery-limit)
)

func (d Destino) String() string { return [...]string{"ack", "dlq", "devolver"}[d] }

// Repositorio é a parte do repositório que o consumidor usa.
type Repositorio interface {
	Criar(ctx context.Context, messageID string, n repositorio.NovaSaga) (saga.Saida, bool, error)
	AplicarMensagem(ctx context.Context, messageID, tipo, sagaID string, ev saga.Evento) (saga.Saida, bool, error)
}

type envelope struct {
	MessageID     string          `json:"messageId"`
	Type          string          `json:"type"`
	Version       int             `json:"version"`
	CorrelationID string          `json:"correlationId"`
	SagaID        string          `json:"sagaId"`
	Payload       json.RawMessage `json:"payload"`
}

// payload reúne os campos que interessam ao Orquestrador em qualquer das mensagens.
type payload struct {
	// respostas dos participantes
	Motivo         string   `json:"motivo"`
	CamposFaltando []string `json:"camposFaltando"`
	ResponsavelID  string   `json:"responsavelId"`
	AnimalNome     string   `json:"animalNome"`
	// solicitacao.*
	AdotanteID string `json:"adotanteId"`
	AnimalID   string `json:"animalId"`
	Decisao    string `json:"decisao"`
}

// respostas dos participantes que o Orquestrador conhece (docs/contratos/eventos.md)
var respostas = map[string]saga.TipoEvento{
	"AnimalReservado":     saga.EvAnimalReservado,
	"ReservaRecusada":     saga.EvReservaRecusada,
	"ReservaLiberada":     saga.EvReservaLiberada,
	"AdocaoConfirmada":    saga.EvAdocaoConfirmada,
	"ConfirmacaoRecusada": saga.EvConfirmacaoRecusada,
	"PerfilValidado":      saga.EvPerfilValidado,
	"PerfilRecusado":      saga.EvPerfilRecusado,
	"VagaLiberada":        saga.EvVagaLiberada,
	"AdocaoRegistrada":    saga.EvAdocaoRegistrada,
}

// decisões de solicitacao.decidida
var decisoes = map[string]saga.TipoEvento{
	"APROVADA":  saga.EvAprovacao,
	"RECUSADA":  saga.EvRecusa,
	"CANCELADA": saga.EvCancelamento,
}

var errInvalida = errors.New("mensagem inválida")

// Mensagem decodificada: um evento para uma SAGA existente ou, em solicitacao.criada, a
// SAGA a criar.
type Mensagem struct {
	Envelope envelope
	Evento   saga.Evento
	Nova     *repositorio.NovaSaga
}

// Decodificar transforma o corpo da mensagem no que o repositório aplica.
func Decodificar(corpo []byte) (Mensagem, error) {
	var m Mensagem
	env := &m.Envelope
	if err := json.Unmarshal(corpo, env); err != nil {
		return m, fmt.Errorf("%w: JSON: %v", errInvalida, err)
	}
	if env.MessageID == "" || env.SagaID == "" {
		return m, fmt.Errorf("%w: sem messageId ou sagaId", errInvalida)
	}
	// leitor tolerante (ADR-006): só processa a versão que conhece; o resto vai para a DLQ
	if env.Version != 1 {
		return m, fmt.Errorf("%w: versão %d desconhecida", errInvalida, env.Version)
	}
	var p payload
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return m, fmt.Errorf("%w: payload: %v", errInvalida, err)
		}
	}

	switch env.Type {
	case "solicitacao.criada":
		if p.AdotanteID == "" || p.AnimalID == "" {
			return m, fmt.Errorf("%w: solicitacao.criada sem adotanteId ou animalId", errInvalida)
		}
		m.Nova = &repositorio.NovaSaga{ID: env.SagaID, AdotanteID: p.AdotanteID, AnimalID: p.AnimalID, CorrelationID: env.CorrelationID}
		m.Evento = saga.Evento{Tipo: saga.EvSolicitacaoCriada}
		return m, nil
	case "solicitacao.decidida":
		tipo, ok := decisoes[p.Decisao]
		if !ok {
			return m, fmt.Errorf("%w: decisão %q desconhecida", errInvalida, p.Decisao)
		}
		m.Evento = saga.Evento{Tipo: tipo, Motivo: p.Motivo}
		return m, nil
	case "solicitacao.retomada":
		m.Evento = saga.Evento{Tipo: saga.EvRetomada}
		return m, nil
	}

	tipo, ok := respostas[env.Type]
	if !ok {
		return m, fmt.Errorf("%w: tipo %q desconhecido", errInvalida, env.Type)
	}
	m.Evento = saga.Evento{Tipo: tipo, Motivo: p.Motivo, CamposFaltando: p.CamposFaltando,
		ResponsavelID: p.ResponsavelID, AnimalNome: p.AnimalNome}
	return m, nil
}

type Consumidor struct {
	repo Repositorio
	log  *slog.Logger
	Fila string
}

// Novo cria o consumidor de uma das filas do Orquestrador.
func Novo(repo Repositorio, log *slog.Logger, fila string) *Consumidor {
	return &Consumidor{repo: repo, log: log.With("fila", fila), Fila: fila}
}

// Processar decide o destino de uma mensagem. Não depende do RabbitMQ, para ser testável.
func (c *Consumidor) Processar(ctx context.Context, corpo []byte) Destino {
	m, err := Decodificar(corpo)
	env := m.Envelope
	log := c.log.With("messageId", env.MessageID, "sagaId", env.SagaID, "correlationId", env.CorrelationID, "tipo", env.Type)
	if err != nil {
		log.Error("mensagem inválida, enviada para a DLQ", "erro", err.Error())
		return ParaDLQ
	}

	var saida saga.Saida
	var duplicada bool
	if m.Nova != nil {
		saida, duplicada, err = c.repo.Criar(ctx, env.MessageID, *m.Nova)
	} else {
		saida, duplicada, err = c.repo.AplicarMensagem(ctx, env.MessageID, env.Type, env.SagaID, m.Evento)
	}
	switch {
	case errors.Is(err, saga.ErrEstadoNaoPermite):
		// decisão que perdeu a corrida para a expiração, ou retomada repetida: não há o que
		// fazer, e a Adoção já mostra o estado real pelo saga.transicao
		log.Warn("ação sem efeito no estado atual da SAGA", "erro", err.Error())
		return Ack
	case errors.Is(err, repositorio.ErrNaoEncontrada):
		log.Error("mensagem para uma SAGA que não existe, enviada para a DLQ")
		return ParaDLQ
	case err != nil && errors.Is(err, saga.ErrRespostaInesperada):
		log.Error("mensagem fora do esperado para o estado, enviada para a DLQ", "erro", err.Error())
		return ParaDLQ
	case err != nil:
		log.Warn("erro ao processar a mensagem, devolvida para a fila", "erro", err.Error())
		return Devolver
	case duplicada:
		log.Info("mensagem repetida, ignorada pela inbox")
		return Ack
	case saida.Ignorada:
		log.Info("mensagem sem efeito no estado atual", "estado", saida.Solicitacao.Estado)
		return Ack
	}
	log.Info("transição aplicada", "transicao", saida.Transicao, "estado", saida.Solicitacao.Estado,
		"passos", len(saida.Passos), "mensagens", len(saida.Mensagens))
	return Ack
}

// Rodar consome a fila até o contexto acabar, reconectando depois de uma queda do broker.
func (c *Consumidor) Rodar(ctx context.Context, url string) {
	for ctx.Err() == nil {
		if err := c.consumir(ctx, url); err != nil && ctx.Err() == nil {
			c.log.Warn("consumidor desconectado; tentando de novo em 2 s", "erro", err.Error())
			select {
			case <-ctx.Done():
			case <-time.After(2 * time.Second):
			}
		}
	}
}

func (c *Consumidor) consumir(ctx context.Context, url string) error {
	conn, err := amqp.Dial(url)
	if err != nil {
		return err
	}
	defer conn.Close()
	canal, err := conn.Channel()
	if err != nil {
		return err
	}
	if err := canal.Qos(10, 0, false); err != nil {
		return err
	}
	entregas, err := canal.ConsumeWithContext(ctx, c.Fila, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	c.log.Info("consumindo")
	fechou := conn.NotifyClose(make(chan *amqp.Error, 1))
	for {
		select {
		case <-ctx.Done():
			return nil
		case e := <-fechou:
			return fmt.Errorf("conexão fechada: %v", e)
		case d, ok := <-entregas:
			if !ok {
				return errors.New("canal de entregas fechado")
			}
			switch c.Processar(ctx, d.Body) {
			case Ack:
				err = d.Ack(false)
			case ParaDLQ:
				err = d.Nack(false, false)
			case Devolver:
				err = d.Nack(false, true)
			}
			if err != nil {
				return fmt.Errorf("confirmar entrega: %w", err)
			}
		}
	}
}
