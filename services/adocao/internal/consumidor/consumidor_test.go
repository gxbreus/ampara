package consumidor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/gxbreus/ampara/services/adocao/internal/db"
	"github.com/gxbreus/ampara/services/adocao/internal/repositorio"
)

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

func corpo(msgID, tipo, sagaID, payload string, versao int) []byte {
	return []byte(fmt.Sprintf(`{"messageId":%q,"type":%q,"version":%d,"correlationId":"c","sagaId":%q,"occurredAt":"2026-11-17T15:00:00Z","payload":%s}`,
		msgID, tipo, versao, sagaID, payload))
}

func transicao(sagaID string, versao int, de, estado string) string {
	deJSON := "null"
	if de != "" {
		deJSON = fmt.Sprintf("%q", de)
	}
	return fmt.Sprintf(`{"solicitacaoId":%q,"versao":%d,"de":%s,"estado":%q,"desfecho":null,"motivo":null,"camposFaltando":null,
		"animalNome":"Thor","responsavelId":"c50a83ab-7db0-41b4-9436-4144c36f97d5","expiraEm":"2026-11-20T15:00:00Z",
		"requerIntervencao":false,"evento":"PerfilValidado","passo":"T2","transicao":5,"em":"2026-11-17T15:00:00.123Z"}`,
		sagaID, versao, deJSON, estado)
}

func TestDecodificar(t *testing.T) {
	_, tr, err := Decodificar(corpo("m1", TipoTransicao, "s1", transicao("s1", 3, "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO"), 1))
	if err != nil || tr.Versao != 3 || tr.Estado != "AGUARDANDO_APROVACAO" || tr.De == nil || *tr.De != "ANIMAL_RESERVADO" ||
		tr.ExpiraEm == nil || tr.AnimalNome == nil || tr.Transicao != 5 || tr.Em.IsZero() {
		t.Fatalf("saga.transicao: %+v %v", tr, err)
	}
	// campo desconhecido no payload é ignorado (leitor tolerante)
	if _, _, err := Decodificar(corpo("m2", TipoTransicao, "s1", `{"solicitacaoId":"s1","versao":1,"estado":"SOLICITADA","campoNovo":1}`, 1)); err != nil {
		t.Fatalf("campo novo deveria ser ignorado: %v", err)
	}
	invalidas := map[string][]byte{
		"JSON quebrado":       []byte(`{"messageId":`),
		"versão desconhecida": corpo("m", TipoTransicao, "s", transicao("s", 1, "", "SOLICITADA"), 2),
		"tipo desconhecido":   corpo("m", "AnimalReservado", "s", `{}`, 1),
		"sem sagaId":          corpo("m", TipoTransicao, "", transicao("", 1, "", "SOLICITADA"), 1),
		"saga trocada":        corpo("m", TipoTransicao, "s1", transicao("s2", 1, "", "SOLICITADA"), 1),
		"sem versão":          corpo("m", TipoTransicao, "s", transicao("s", 0, "", "SOLICITADA"), 1),
		"estado inventado":    corpo("m", TipoTransicao, "s", transicao("s", 1, "", "INVENTADO"), 1),
	}
	for nome, c := range invalidas {
		if _, _, err := Decodificar(c); !errors.Is(err, errInvalida) {
			t.Errorf("%s: erro = %v", nome, err)
		}
	}
}

type aplicadorFalso struct {
	duplicada bool
	err       error
}

func (a aplicadorFalso) AplicarTransicao(context.Context, string, repositorio.Transicao) (bool, error) {
	return a.duplicada, a.err
}

func TestDestinoDaMensagem(t *testing.T) {
	valida := corpo("m1", TipoTransicao, "s1", transicao("s1", 1, "", "SOLICITADA"), 1)
	casos := []struct {
		nome    string
		corpo   []byte
		repo    aplicadorFalso
		destino Destino
	}{
		{"aplicada", valida, aplicadorFalso{}, Ack},
		{"repetida", valida, aplicadorFalso{duplicada: true}, Ack},
		{"inválida", []byte("lixo"), aplicadorFalso{}, ParaDLQ},
		{"solicitação inexistente", valida, aplicadorFalso{err: repositorio.ErrNaoEncontrada}, ParaDLQ},
		{"banco fora do ar", valida, aplicadorFalso{err: errors.New("conexão recusada")}, Devolver},
	}
	for _, c := range casos {
		if got := Novo(c.repo, silencioso).Processar(context.Background(), c.corpo); got != c.destino {
			t.Errorf("%s: destino %s, esperado %s", c.nome, got, c.destino)
		}
	}
}

// Integração: ADOCAO_TEST_DATABASE_URL, ADOCAO_TEST_AMQP_URL (usuário adocao) e
// ADOCAO_TEST_AMQP_ORQUESTRADOR_URL (usuário orquestrador, que publica saga.transicao).
func TestConsumidorComBrokerReal(t *testing.T) {
	dbURL, amqpURL, orqURL := os.Getenv("ADOCAO_TEST_DATABASE_URL"), os.Getenv("ADOCAO_TEST_AMQP_URL"), os.Getenv("ADOCAO_TEST_AMQP_ORQUESTRADOR_URL")
	if dbURL == "" || amqpURL == "" || orqURL == "" {
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
	repo := repositorio.Novo(pool, repositorio.Config{})
	id := repositorio.NovoUUID()
	if err := repo.Criar(ctx, repositorio.NovaSolicitacao{ID: id, AdotanteID: "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55", AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}); err != nil {
		t.Fatal(err)
	}
	go Novo(repo, silencioso).Rodar(ctx, amqpURL)

	conn, err := amqp.Dial(orqURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	canal, _ := conn.Channel()
	publicar := func(c []byte) {
		if err := canal.PublishWithContext(ctx, "ampara.eventos", TipoTransicao, true, false, amqp.Publishing{ContentType: "application/json", Body: c}); err != nil {
			t.Fatal(err)
		}
	}
	estado := func() (e string, linhas int) {
		_ = pool.QueryRow(ctx, `SELECT estado FROM solicitacoes WHERE id = $1`, id).Scan(&e)
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM historico WHERE saga_id = $1`, id).Scan(&linhas)
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

	m := corpo("9b2d4f6a-1c3e-4a5b-8d7f-0e1a2b3c4d5e", TipoTransicao, id, transicao(id, 1, "", "SOLICITADA"), 1)
	publicar(m)
	publicar(corpo(repositorio.NovoUUID(), TipoTransicao, id, transicao(id, 2, "SOLICITADA", "ANIMAL_RESERVADO"), 1))
	if !esperar(func() bool { e, n := estado(); return e == "ANIMAL_RESERVADO" && n == 2 }) {
		e, n := estado()
		t.Fatalf("o espelho não chegou a ANIMAL_RESERVADO com 2 linhas: %s, %d", e, n)
	}

	// a mesma mensagem de novo (reentrega): a inbox impede outra linha na linha do tempo
	publicar(m)
	time.Sleep(time.Second)
	if e, n := estado(); e != "ANIMAL_RESERVADO" || n != 2 {
		t.Fatalf("depois da repetida: estado %s, %d linhas", e, n)
	}

	// mensagem inválida vai direto para a DLQ
	publicar([]byte(`{"isto":"não é um envelope"}`))
	adocao, _ := amqp.Dial(amqpURL)
	defer adocao.Close()
	c, _ := adocao.Channel()
	if !esperar(func() bool {
		q, err := c.QueueDeclarePassive(FilaDLQ, true, false, false, false, amqp.Table{"x-queue-type": "quorum"})
		return err == nil && q.Messages >= 1
	}) {
		t.Fatal("a mensagem inválida não chegou à adocao.saga.dlq")
	}
}

func TestAlertaDLQRegistraUmaVezSemTirarDaFila(t *testing.T) {
	amqpURL, adminURL := os.Getenv("ADOCAO_TEST_AMQP_URL"), os.Getenv("ADOCAO_TEST_AMQP_ADMIN_URL")
	if amqpURL == "" || adminURL == "" {
		t.Skip("variáveis de integração não definidas")
	}
	admin, err := amqp.Dial(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	canal, _ := admin.Channel()
	_, _ = canal.QueuePurge(FilaDLQ, false)
	_, _ = canal.QueuePurge(Fila, false)
	// duas mensagens mortas de verdade: publicadas na fila de origem e rejeitadas sem requeue,
	// para o próprio RabbitMQ preencher o x-death (cliente não consegue forjar esse cabeçalho)
	for i, id := range []string{"aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"} {
		if err := canal.PublishWithContext(context.Background(), "ampara.eventos", TipoTransicao, false, false, amqp.Publishing{
			MessageId: id, Type: TipoTransicao, Body: corpo(id, TipoTransicao, fmt.Sprintf("saga-%d", i), `{}`, 9),
		}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		var m amqp.Delivery
		var ok bool
		for tentativa := 0; tentativa < 50 && !ok; tentativa++ {
			m, ok, _ = canal.Get(Fila, false)
			if !ok {
				time.Sleep(50 * time.Millisecond)
			}
		}
		if !ok {
			t.Fatal("a mensagem não chegou à fila de origem")
		}
		_ = m.Nack(false, false) // vai para a DLX, como uma mensagem inválida
	}
	for i := 0; i < 50; i++ {
		if q, err := canal.QueueDeclarePassive(FilaDLQ, true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); err == nil && q.Messages == 2 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	var logs strings.Builder
	alerta := NovoAlertaDLQ(slog.New(slog.NewJSONHandler(&logs, nil)))
	n1, err := alerta.Ciclo(amqpURL)
	if err != nil {
		t.Fatal(err)
	}
	n2, _ := alerta.Ciclo(amqpURL)
	if n1 != 2 || n2 != 0 {
		t.Fatalf("primeiro ciclo registrou %d, segundo %d; esperado 2 e 0", n1, n2)
	}
	if strings.Count(logs.String(), `"level":"ERROR"`) != 2 || !strings.Contains(logs.String(), `"filaDeOrigem":"adocao.saga"`) ||
		!strings.Contains(logs.String(), `"sagaId":"saga-0"`) {
		t.Fatalf("logs: %s", logs.String())
	}
	// a contagem da quorum queue leva um instante para refletir o nack com requeue
	var q amqp.Queue
	for i := 0; i < 50; i++ {
		if q, err = canal.QueueDeclarePassive(FilaDLQ, true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); err == nil && q.Messages == 2 {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("as mensagens deveriam continuar na DLQ: %d (%v)", q.Messages, err)
}
