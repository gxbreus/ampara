package consumidor

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// FilasDLQ são as DLQs das filas que o Orquestrador consome.
var FilasDLQ = []string{FilaRespostas + ".dlq", FilaSolicitacoes + ".dlq"}

// AlertaDLQ registra cada mensagem que chega às DLQs do Orquestrador, sem tirá-la de lá (#86).
// Reprocessar automaticamente recriaria o loop com a mensagem envenenada; quem decide é a
// operação, com scripts/dlq.sh. Por isso o alerta só espia: lê as mensagens sem confirmar,
// registra as novas e devolve todas para a fila.
type AlertaDLQ struct {
	log       *slog.Logger
	Intervalo time.Duration
	Filas     []string
	vistas    map[string]bool
}

func NovoAlertaDLQ(log *slog.Logger) *AlertaDLQ {
	return &AlertaDLQ{log: log, Intervalo: 10 * time.Second, Filas: FilasDLQ, vistas: map[string]bool{}}
}

func (a *AlertaDLQ) Rodar(ctx context.Context, url string) {
	t := time.NewTicker(a.Intervalo)
	defer t.Stop()
	for {
		if _, err := a.Ciclo(url); err != nil && ctx.Err() == nil {
			a.log.Warn("alerta da DLQ", "erro", err.Error())
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Ciclo lê cada DLQ inteira uma vez e devolve quantas mensagens novas registrou.
func (a *AlertaDLQ) Ciclo(url string) (int, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	novas := 0
	for _, fila := range a.Filas {
		n, err := a.espiar(conn, fila)
		novas += n
		if err != nil {
			return novas, err
		}
	}
	return novas, nil
}

func (a *AlertaDLQ) espiar(conn *amqp.Connection, fila string) (int, error) {
	canal, err := conn.Channel()
	if err != nil {
		return 0, err
	}
	defer canal.Close()

	novas := 0
	var ultima uint64
	for {
		// sem ack: a mensagem fica "em uso" e o próximo Get traz a seguinte
		m, ok, err := canal.Get(fila, false)
		if err != nil {
			return novas, err
		}
		if !ok {
			break
		}
		ultima = m.DeliveryTag
		id := chave(m)
		if a.vistas[id] {
			continue
		}
		a.vistas[id] = true
		novas++
		a.registrar(fila, m)
	}
	if ultima > 0 {
		// devolve todas de uma vez, na mesma ordem
		if err := canal.Nack(ultima, true, true); err != nil {
			return novas, err
		}
	}
	return novas, nil
}

func (a *AlertaDLQ) registrar(fila string, m amqp.Delivery) {
	var env struct {
		MessageID     string `json:"messageId"`
		Type          string `json:"type"`
		SagaID        string `json:"sagaId"`
		CorrelationID string `json:"correlationId"`
	}
	_ = json.Unmarshal(m.Body, &env)
	attrs := []any{
		"fila", fila,
		"messageId", primeiro(env.MessageID, m.MessageId),
		"tipo", primeiro(env.Type, m.Type),
		"sagaId", env.SagaID,
		"correlationId", primeiro(env.CorrelationID, m.CorrelationId),
	}
	// x-death: por que e de onde a mensagem morreu (o RabbitMQ preenche ao mandar para a DLX)
	if mortes, ok := m.Headers["x-death"].([]any); ok && len(mortes) > 0 {
		if morte, ok := mortes[0].(amqp.Table); ok {
			attrs = append(attrs, "motivo", morte["reason"], "filaDeOrigem", morte["queue"], "mortes", morte["count"])
		}
	}
	a.log.Error("mensagem na DLQ: precisa de análise e reprocessamento manual (scripts/dlq.sh)", attrs...)
}

// chave identifica a mensagem entre ciclos: o messageId, ou o hash do corpo se ela não tiver.
func chave(m amqp.Delivery) string {
	if m.MessageId != "" {
		return m.MessageId
	}
	h := sha256.Sum256(m.Body)
	return hex.EncodeToString(h[:])
}

func primeiro(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
