// Package consumidor mantém o espelho da SAGA (fila adocao.saga). O Orquestrador publica
// saga.transicao a cada mudança de estado (ADR-008), e a Adoção atualiza a solicitação e a
// linha do tempo que o usuário vê.
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

const (
	Fila          = "adocao.saga"
	TipoTransicao = "saga.transicao"
)

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
	AplicarTransicao(ctx context.Context, messageID string, t repositorio.Transicao) (bool, error)
}

type envelope struct {
	MessageID     string          `json:"messageId"`
	Type          string          `json:"type"`
	Version       int             `json:"version"`
	CorrelationID string          `json:"correlationId"`
	SagaID        string          `json:"sagaId"`
	Payload       json.RawMessage `json:"payload"`
}

var errInvalida = errors.New("mensagem inválida")

// Decodificar transforma o corpo da mensagem na transição que o repositório aplica.
func Decodificar(corpo []byte) (envelope, repositorio.Transicao, error) {
	var env envelope
	var t repositorio.Transicao
	if err := json.Unmarshal(corpo, &env); err != nil {
		return env, t, fmt.Errorf("%w: JSON: %v", errInvalida, err)
	}
	if env.MessageID == "" || env.SagaID == "" {
		return env, t, fmt.Errorf("%w: sem messageId ou sagaId", errInvalida)
	}
	// leitor tolerante (ADR-006): só processa a versão que conhece; o resto vai para a DLQ
	if env.Version != 1 {
		return env, t, fmt.Errorf("%w: versão %d desconhecida", errInvalida, env.Version)
	}
	if env.Type != TipoTransicao {
		return env, t, fmt.Errorf("%w: tipo %q desconhecido", errInvalida, env.Type)
	}
	if err := json.Unmarshal(env.Payload, &t); err != nil {
		return env, t, fmt.Errorf("%w: payload: %v", errInvalida, err)
	}
	if t.SolicitacaoID == "" {
		t.SolicitacaoID = env.SagaID
	}
	if t.SolicitacaoID != env.SagaID || t.Versao < 1 || !saga.Estado(t.Estado).Valido() {
		return env, t, fmt.Errorf("%w: solicitacaoId, versão ou estado inválido", errInvalida)
	}
	return env, t, nil
}

type Consumidor struct {
	repo Aplicador
	log  *slog.Logger
}

func Novo(repo Aplicador, log *slog.Logger) *Consumidor { return &Consumidor{repo: repo, log: log} }

// Processar decide o destino de uma mensagem. Não depende do RabbitMQ, para ser testável.
func (c *Consumidor) Processar(ctx context.Context, corpo []byte) Destino {
	env, t, err := Decodificar(corpo)
	log := c.log.With("messageId", env.MessageID, "sagaId", env.SagaID, "correlationId", env.CorrelationID, "tipo", env.Type)
	if err != nil {
		log.Error("mensagem inválida, enviada para a DLQ", "erro", err.Error())
		return ParaDLQ
	}

	duplicada, err := c.repo.AplicarTransicao(ctx, env.MessageID, t)
	switch {
	case errors.Is(err, repositorio.ErrNaoEncontrada):
		log.Error("transição de uma solicitação que não existe, enviada para a DLQ")
		return ParaDLQ
	case err != nil:
		log.Warn("erro ao aplicar a transição, devolvida para a fila", "erro", err.Error())
		return Devolver
	case duplicada:
		log.Info("transição repetida, ignorada pela inbox")
		return Ack
	}
	log.Info("espelho atualizado", "versao", t.Versao, "estado", t.Estado, "transicao", t.Transicao)
	return Ack
}

// Rodar consome a fila até o contexto acabar, reconectando depois de uma queda do broker.
func (c *Consumidor) Rodar(ctx context.Context, url string) {
	for ctx.Err() == nil {
		if err := c.consumir(ctx, url); err != nil && ctx.Err() == nil {
			c.log.Warn("consumidor de transições desconectado; tentando de novo em 2 s", "erro", err.Error())
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
	c.log.Info("consumindo transições", "fila", Fila)
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
