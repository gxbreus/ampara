package outbox

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// PublicadorAMQP publica com publisher confirms e reconecta sozinho depois de uma queda
// do broker: a conexão é refeita na próxima publicação.
type PublicadorAMQP struct {
	url string

	mu         sync.Mutex
	conn       *amqp.Connection
	canal      *amqp.Channel
	devolvidas chan amqp.Return
}

func NovoPublicadorAMQP(url string) *PublicadorAMQP { return &PublicadorAMQP{url: url} }

func (p *PublicadorAMQP) Publicar(ctx context.Context, m Mensagem) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if err := p.conectar(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	confirmacao, err := p.canal.PublishWithDeferredConfirmWithContext(ctx, m.Exchange, m.RoutingKey,
		true, // mandatory: sem fila para a routing key, o broker devolve em vez de descartar
		false,
		amqp.Publishing{
			ContentType:   "application/json",
			DeliveryMode:  amqp.Persistent,
			MessageId:     m.MessageID,
			Type:          m.Tipo,
			CorrelationId: m.CorrelationID,
			Timestamp:     time.Now().UTC(),
			Body:          m.Corpo,
		})
	if err != nil {
		p.fechar()
		return fmt.Errorf("publicar %s: %w", m.Tipo, err)
	}
	ok, err := confirmacao.WaitContext(ctx)
	if err != nil {
		p.fechar()
		return fmt.Errorf("esperar confirm de %s: %w", m.Tipo, err)
	}
	if !ok {
		return errors.New("o broker recusou a mensagem (nack)")
	}
	// O broker manda o basic.return antes do ack: se a mensagem não tinha fila de destino,
	// ela chegou aqui e não pode ser dada como publicada.
	select {
	case d := <-p.devolvidas:
		if d.MessageId == m.MessageID {
			return fmt.Errorf("nenhuma fila para %s/%s: %s", m.Exchange, m.RoutingKey, d.ReplyText)
		}
	default:
	}
	return nil
}

func (p *PublicadorAMQP) conectar() error {
	if p.canal != nil && !p.canal.IsClosed() {
		return nil
	}
	p.fechar()
	conn, err := amqp.Dial(p.url)
	if err != nil {
		return fmt.Errorf("conectar ao RabbitMQ: %w", err)
	}
	canal, err := conn.Channel()
	if err != nil {
		conn.Close()
		return fmt.Errorf("abrir canal: %w", err)
	}
	if err := canal.Confirm(false); err != nil {
		conn.Close()
		return fmt.Errorf("ativar publisher confirms: %w", err)
	}
	p.devolvidas = canal.NotifyReturn(make(chan amqp.Return, 16))
	p.conn, p.canal = conn, canal
	return nil
}

func (p *PublicadorAMQP) fechar() {
	if p.conn != nil {
		_ = p.conn.Close()
	}
	p.conn, p.canal = nil, nil
}

// Fechar encerra a conexão.
func (p *PublicadorAMQP) Fechar() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.fechar()
}
