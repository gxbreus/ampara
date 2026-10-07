// Package consumidor processa as respostas dos participantes da SAGA (fila adocao.respostas).
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

	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

const Fila = "adocao.respostas"

// Destino diz o que fazer com a mensagem depois de processada.
type Destino int

const (
	Ack      Destino = iota // processada (ou repetida)
	ParaDLQ                 // inválida: nack sem requeue, vai direto para a DLQ
	Devolver                // erro temporário: nack com requeue (até o x-delivery-limit)
)

func (d Destino) String() string { return [...]string{"ack", "dlq", "devolver"}[d] }

// Aplicador é a parte do repositório que o consumidor usa.
type Aplicador interface {
	AplicarResposta(ctx context.Context, messageID, tipo, sagaID string, ev saga.Evento) (saga.Saida, bool, error)
}

type envelope struct {
	MessageID     string          `json:"messageId"`
	Type          string          `json:"type"`
	Version       int             `json:"version"`
	CorrelationID string          `json:"correlationId"`
	SagaID        string          `json:"sagaId"`
	Payload       json.RawMessage `json:"payload"`
}

type payloadResposta struct {
	Motivo         string   `json:"motivo"`
	CamposFaltando []string `json:"camposFaltando"`
	ResponsavelID  string   `json:"responsavelId"`
	AnimalNome     string   `json:"animalNome"`
}

// respostas que a Adoção conhece (docs/contratos/eventos.md)
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

var errInvalida = errors.New("mensagem inválida")

// Decodificar transforma o corpo da mensagem no evento da máquina.
func Decodificar(corpo []byte) (envelope, saga.Evento, error) {
	var env envelope
	if err := json.Unmarshal(corpo, &env); err != nil {
		return env, saga.Evento{}, fmt.Errorf("%w: JSON: %v", errInvalida, err)
	}
	if env.MessageID == "" || env.SagaID == "" {
		return env, saga.Evento{}, fmt.Errorf("%w: sem messageId ou sagaId", errInvalida)
	}
	// leitor tolerante (ADR-006): só processa a versão que conhece; o resto vai para a DLQ
	if env.Version != 1 {
		return env, saga.Evento{}, fmt.Errorf("%w: versão %d desconhecida", errInvalida, env.Version)
	}
	tipo, ok := respostas[env.Type]
	if !ok {
		return env, saga.Evento{}, fmt.Errorf("%w: tipo %q desconhecido", errInvalida, env.Type)
	}
	var p payloadResposta
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return env, saga.Evento{}, fmt.Errorf("%w: payload: %v", errInvalida, err)
		}
	}
	return env, saga.Evento{Tipo: tipo, Motivo: p.Motivo, CamposFaltando: p.CamposFaltando,
		ResponsavelID: p.ResponsavelID, AnimalNome: p.AnimalNome}, nil
}

type Consumidor struct {
	repo Aplicador
	log  *slog.Logger
}

func Novo(repo Aplicador, log *slog.Logger) *Consumidor { return &Consumidor{repo: repo, log: log} }

// Processar decide o destino de uma mensagem. Não depende do RabbitMQ, para ser testável.
func (c *Consumidor) Processar(ctx context.Context, corpo []byte) Destino {
	env, ev, err := Decodificar(corpo)
	log := c.log.With("messageId", env.MessageID, "sagaId", env.SagaID, "correlationId", env.CorrelationID, "tipo", env.Type)
	if err != nil {
		log.Error("resposta inválida, enviada para a DLQ", "erro", err.Error())
		return ParaDLQ
	}

	saida, duplicada, err := c.repo.AplicarResposta(ctx, env.MessageID, env.Type, env.SagaID, ev)
	switch {
	case errors.Is(err, repositorio.ErrNaoEncontrada):
		log.Error("resposta para uma solicitação que não existe, enviada para a DLQ")
		return ParaDLQ
	case err != nil && !temporario(err):
		log.Error("resposta fora do esperado para o estado, enviada para a DLQ", "erro", err.Error())
		return ParaDLQ
	case err != nil:
		log.Warn("erro ao processar a resposta, devolvida para a fila", "erro", err.Error())
		return Devolver
	case duplicada:
		log.Info("resposta repetida, ignorada pela inbox")
		return Ack
	case saida.Ignorada:
		log.Info("resposta sem efeito no estado atual", "estado", saida.Solicitacao.Estado)
		return Ack
	}
	log.Info("transição aplicada", "transicao", saida.Transicao, "estado", saida.Solicitacao.Estado,
		"passos", len(saida.Passos), "mensagens", len(saida.Mensagens))
	return Ack
}

// temporario: erro de infraestrutura (banco, contexto), que vale tentar de novo. Erro da
// máquina de estados é definitivo: a mesma mensagem falharia sempre.
func temporario(err error) bool {
	return !errors.Is(err, saga.ErrRespostaInesperada) && !errors.Is(err, saga.ErrEstadoNaoPermite)
}

// Rodar consome a fila até o contexto acabar, reconectando depois de uma queda do broker.
func (c *Consumidor) Rodar(ctx context.Context, url string) {
	for ctx.Err() == nil {
		if err := c.consumir(ctx, url); err != nil && ctx.Err() == nil {
			c.log.Warn("consumidor de respostas desconectado; tentando de novo em 2 s", "erro", err.Error())
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
	entregas, err := canal.ConsumeWithContext(ctx, Fila, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	c.log.Info("consumindo respostas", "fila", Fila)
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
