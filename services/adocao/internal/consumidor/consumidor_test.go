package consumidor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/gxbreus/ampara/services/adocao/internal/db"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
	"github.com/gxbreus/ampara/services/adocao/internal/saga"
)

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

func corpo(msgID, tipo, sagaID, payload string, versao int) []byte {
	return []byte(fmt.Sprintf(`{"messageId":%q,"type":%q,"version":%d,"correlationId":"c","sagaId":%q,"occurredAt":"2026-11-17T15:00:00Z","payload":%s}`,
		msgID, tipo, versao, sagaID, payload))
}

func TestDecodificar(t *testing.T) {
	_, ev, err := Decodificar(corpo("m1", "AnimalReservado", "s1", `{"animalId":"a","responsavelId":"r1","animalNome":"Thor"}`, 1))
	if err != nil || ev.Tipo != saga.EvAnimalReservado || ev.ResponsavelID != "r1" || ev.AnimalNome != "Thor" {
		t.Fatalf("AnimalReservado: %+v %v", ev, err)
	}
	_, ev, err = Decodificar(corpo("m2", "PerfilRecusado", "s1", `{"adotanteId":"x","motivo":"PERFIL_INCOMPLETO","camposFaltando":["aceiteTermo"]}`, 1))
	if err != nil || ev.Motivo != "PERFIL_INCOMPLETO" || len(ev.CamposFaltando) != 1 {
		t.Fatalf("PerfilRecusado: %+v %v", ev, err)
	}
	// campo desconhecido no payload é ignorado (leitor tolerante)
	if _, _, err := Decodificar(corpo("m3", "VagaLiberada", "s1", `{"adotanteId":"x","liberou":true,"campoNovo":1}`, 1)); err != nil {
		t.Fatalf("campo novo deveria ser ignorado: %v", err)
	}
	invalidas := map[string][]byte{
		"JSON quebrado":       []byte(`{"messageId":`),
		"versão desconhecida": corpo("m", "AnimalReservado", "s", `{}`, 2),
		"tipo desconhecido":   corpo("m", "Inventado", "s", `{}`, 1),
		"sem sagaId":          corpo("m", "AnimalReservado", "", `{}`, 1),
	}
	for nome, c := range invalidas {
		if _, _, err := Decodificar(c); !errors.Is(err, errInvalida) {
			t.Errorf("%s: erro = %v", nome, err)
		}
	}
}

type aplicadorFalso struct {
	saida     saga.Saida
	duplicada bool
	err       error
}

func (a aplicadorFalso) AplicarResposta(context.Context, string, string, string, saga.Evento) (saga.Saida, bool, error) {
	return a.saida, a.duplicada, a.err
}

func TestDestinoDaMensagem(t *testing.T) {
	valida := corpo("m1", "ReservaLiberada", "s1", `{"liberou":true}`, 1)
	casos := []struct {
		nome    string
		corpo   []byte
		repo    aplicadorFalso
		destino Destino
	}{
		{"aplicada", valida, aplicadorFalso{saida: saga.Saida{Transicao: 12}}, Ack},
		{"repetida", valida, aplicadorFalso{duplicada: true}, Ack},
		{"sem efeito", valida, aplicadorFalso{saida: saga.Saida{Ignorada: true}}, Ack},
		{"inválida", []byte("lixo"), aplicadorFalso{}, ParaDLQ},
		{"solicitação inexistente", valida, aplicadorFalso{err: repositorio.ErrNaoEncontrada}, ParaDLQ},
		{"fora do esperado", valida, aplicadorFalso{err: fmt.Errorf("x: %w", saga.ErrRespostaInesperada)}, ParaDLQ},
		{"banco fora do ar", valida, aplicadorFalso{err: errors.New("conexão recusada")}, Devolver},
	}
	for _, c := range casos {
		if got := Novo(c.repo, silencioso).Processar(context.Background(), c.corpo); got != c.destino {
			t.Errorf("%s: destino %s, esperado %s", c.nome, got, c.destino)
		}
	}
}

// Integração: ADOCAO_TEST_DATABASE_URL, ADOCAO_TEST_AMQP_URL (usuário adocao) e
// ADOCAO_TEST_AMQP_ANIMAIS_URL (usuário animais, que publica em ampara.respostas).
func TestConsumidorComBrokerReal(t *testing.T) {
	dbURL, amqpURL, animaisURL := os.Getenv("ADOCAO_TEST_DATABASE_URL"), os.Getenv("ADOCAO_TEST_AMQP_URL"), os.Getenv("ADOCAO_TEST_AMQP_ANIMAIS_URL")
	if dbURL == "" || amqpURL == "" || animaisURL == "" {
		t.Skip("variáveis de integração não definidas")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool, err := db.Conectar(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	_, _ = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	if err := db.Migrar(dbURL); err != nil {
		t.Fatal(err)
	}
	repo := repositorio.Novo(pool, repositorio.Config{TimeoutPasso: 10 * time.Second, PrazoDecisao: time.Hour, MaxReenvios: 10})
	id := repositorio.NovoUUID()
	if _, err := repo.Criar(ctx, repositorio.NovaSolicitacao{ID: id, AdotanteID: "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55", AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}); err != nil {
		t.Fatal(err)
	}
	go Novo(repo, silencioso).Rodar(ctx, amqpURL)

	conn, err := amqp.Dial(animaisURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	canal, _ := conn.Channel()
	publicar := func(c []byte) {
		if err := canal.PublishWithContext(ctx, "ampara.respostas", "adocao", true, false, amqp.Publishing{ContentType: "application/json", Body: c}); err != nil {
			t.Fatal(err)
		}
	}
	estado := func() (e string, transicoes2 int) {
		_ = pool.QueryRow(ctx, `SELECT estado FROM solicitacoes WHERE id = $1`, id).Scan(&e)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM saga_historico WHERE saga_id = $1 AND transicao = 2`, id).Scan(&transicoes2)
		return
	}
	esperar := func(cond func() bool) bool {
		for i := 0; i < 50; i++ {
			if cond() {
				return true
			}
			time.Sleep(100 * time.Millisecond)
		}
		return false
	}

	resposta := corpo("9b2d4f6a-1c3e-4a5b-8d7f-0e1a2b3c4d5e", "AnimalReservado", id, `{"animalId":"65a2f1c4e8b9d3a7f0c1b2e9","responsavelId":"c50a83ab-7db0-41b4-9436-4144c36f97d5","animalNome":"Thor"}`, 1)
	publicar(resposta)
	if !esperar(func() bool { e, _ := estado(); return e == "ANIMAL_RESERVADO" }) {
		t.Fatal("a resposta não levou a solicitação a ANIMAL_RESERVADO")
	}

	// a mesma mensagem de novo (reentrega): a inbox impede a segunda transição
	publicar(resposta)
	time.Sleep(time.Second)
	if e, n := estado(); e != "ANIMAL_RESERVADO" || n != 1 {
		t.Fatalf("depois da repetida: estado %s, transições 2 = %d", e, n)
	}

	// mensagem inválida vai direto para a DLQ
	publicar([]byte(`{"isto":"não é um envelope"}`))
	admin, _ := amqp.Dial(amqpURL)
	defer admin.Close()
	cAdmin, _ := admin.Channel()
	if !esperar(func() bool {
		q, err := cAdmin.QueueDeclarePassive("adocao.respostas.dlq", true, false, false, false, amqp.Table{"x-queue-type": "quorum"})
		return err == nil && q.Messages >= 1
	}) {
		t.Fatal("a mensagem inválida não chegou à adocao.respostas.dlq")
	}
}
