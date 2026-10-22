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

	"github.com/gxbreus/ampara/services/orquestrador/internal/db"
	"github.com/gxbreus/ampara/services/orquestrador/internal/repositorio"
	"github.com/gxbreus/ampara/services/orquestrador/internal/saga"
)

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

func corpo(msgID, tipo, sagaID, payload string, versao int) []byte {
	return []byte(fmt.Sprintf(`{"messageId":%q,"type":%q,"version":%d,"correlationId":"c","sagaId":%q,"occurredAt":"2026-11-17T15:00:00Z","payload":%s}`,
		msgID, tipo, versao, sagaID, payload))
}

func TestDecodificarRespostas(t *testing.T) {
	m, err := Decodificar(corpo("m1", "AnimalReservado", "s1", `{"animalId":"a","responsavelId":"r1","animalNome":"Thor"}`, 1))
	if err != nil || m.Nova != nil || m.Evento.Tipo != saga.EvAnimalReservado || m.Evento.ResponsavelID != "r1" || m.Evento.AnimalNome != "Thor" {
		t.Fatalf("AnimalReservado: %+v %v", m, err)
	}
	m, err = Decodificar(corpo("m2", "PerfilRecusado", "s1", `{"adotanteId":"x","motivo":"PERFIL_INCOMPLETO","camposFaltando":["aceiteTermo"]}`, 1))
	if err != nil || m.Evento.Motivo != "PERFIL_INCOMPLETO" || len(m.Evento.CamposFaltando) != 1 {
		t.Fatalf("PerfilRecusado: %+v %v", m, err)
	}
	// campo desconhecido no payload é ignorado (leitor tolerante)
	if _, err := Decodificar(corpo("m3", "VagaLiberada", "s1", `{"adotanteId":"x","liberou":true,"campoNovo":1}`, 1)); err != nil {
		t.Fatalf("campo novo deveria ser ignorado: %v", err)
	}
}

func TestDecodificarMensagensDaAdocao(t *testing.T) {
	m, err := Decodificar(corpo("m1", "solicitacao.criada", "s1", `{"solicitacaoId":"s1","adotanteId":"ad","animalId":"an"}`, 1))
	if err != nil || m.Nova == nil || m.Nova.ID != "s1" || m.Nova.AdotanteID != "ad" || m.Nova.AnimalID != "an" || m.Nova.CorrelationID != "c" {
		t.Fatalf("solicitacao.criada: %+v %v", m.Nova, err)
	}
	decisoes := map[string]saga.TipoEvento{"APROVADA": saga.EvAprovacao, "RECUSADA": saga.EvRecusa, "CANCELADA": saga.EvCancelamento}
	for decisao, tipo := range decisoes {
		m, err := Decodificar(corpo("m2", "solicitacao.decidida", "s1", `{"solicitacaoId":"s1","decisao":"`+decisao+`","motivo":"sem tela"}`, 1))
		if err != nil || m.Nova != nil || m.Evento.Tipo != tipo || m.Evento.Motivo != "sem tela" {
			t.Fatalf("%s: %+v %v", decisao, m.Evento, err)
		}
	}
	m, err = Decodificar(corpo("m3", "solicitacao.retomada", "s1", `{"solicitacaoId":"s1"}`, 1))
	if err != nil || m.Evento.Tipo != saga.EvRetomada {
		t.Fatalf("solicitacao.retomada: %+v %v", m.Evento, err)
	}
}

func TestDecodificarInvalidas(t *testing.T) {
	invalidas := map[string][]byte{
		"JSON quebrado":        []byte(`{"messageId":`),
		"versão desconhecida":  corpo("m", "AnimalReservado", "s", `{}`, 2),
		"tipo desconhecido":    corpo("m", "Inventado", "s", `{}`, 1),
		"sem sagaId":           corpo("m", "AnimalReservado", "", `{}`, 1),
		"criada sem animal":    corpo("m", "solicitacao.criada", "s", `{"adotanteId":"a"}`, 1),
		"decisão desconhecida": corpo("m", "solicitacao.decidida", "s", `{"decisao":"TALVEZ"}`, 1),
		"decidida sem decisão": corpo("m", "solicitacao.decidida", "s", `{}`, 1),
	}
	for nome, c := range invalidas {
		if _, err := Decodificar(c); !errors.Is(err, errInvalida) {
			t.Errorf("%s: erro = %v", nome, err)
		}
	}
}

type repoFalso struct {
	saida     saga.Saida
	duplicada bool
	err       error
	criou     bool
}

func (r *repoFalso) Criar(context.Context, string, repositorio.NovaSaga) (saga.Saida, bool, error) {
	r.criou = true
	return r.saida, r.duplicada, r.err
}

func (r *repoFalso) AplicarMensagem(context.Context, string, string, string, saga.Evento) (saga.Saida, bool, error) {
	return r.saida, r.duplicada, r.err
}

func TestDestinoDaMensagem(t *testing.T) {
	valida := corpo("m1", "ReservaLiberada", "s1", `{"liberou":true}`, 1)
	decisao := corpo("m2", "solicitacao.decidida", "s1", `{"decisao":"APROVADA"}`, 1)
	casos := []struct {
		nome    string
		corpo   []byte
		repo    repoFalso
		destino Destino
	}{
		{"aplicada", valida, repoFalso{saida: saga.Saida{Transicao: 12}}, Ack},
		{"repetida", valida, repoFalso{duplicada: true}, Ack},
		{"sem efeito", valida, repoFalso{saida: saga.Saida{Ignorada: true}}, Ack},
		{"inválida", []byte("lixo"), repoFalso{}, ParaDLQ},
		{"SAGA inexistente", valida, repoFalso{err: repositorio.ErrNaoEncontrada}, ParaDLQ},
		{"fora do esperado", valida, repoFalso{err: fmt.Errorf("x: %w", saga.ErrRespostaInesperada)}, ParaDLQ},
		{"banco fora do ar", valida, repoFalso{err: errors.New("conexão recusada")}, Devolver},
		// a decisão perdeu a corrida para a expiração: não é erro de mensagem
		{"decisão tardia", decisao, repoFalso{err: saga.ErrEstadoNaoPermite}, Ack},
	}
	for _, c := range casos {
		if got := Novo(&c.repo, silencioso, FilaRespostas).Processar(context.Background(), c.corpo); got != c.destino {
			t.Errorf("%s: destino %s, esperado %s", c.nome, got, c.destino)
		}
	}
	r := &repoFalso{saida: saga.Saida{Transicao: 1}}
	Novo(r, silencioso, FilaSolicitacoes).Processar(context.Background(), corpo("m3", "solicitacao.criada", "s1", `{"adotanteId":"a","animalId":"b"}`, 1))
	if !r.criou {
		t.Error("solicitacao.criada deveria criar a SAGA")
	}
}

// Integração: ORQUESTRADOR_TEST_DATABASE_URL, ORQUESTRADOR_TEST_AMQP_URL (usuário orquestrador) e
// ORQUESTRADOR_TEST_AMQP_ANIMAIS_URL (usuário animais, que publica em ampara.respostas).
func TestConsumidorComBrokerReal(t *testing.T) {
	dbURL, amqpURL, animaisURL := os.Getenv("ORQUESTRADOR_TEST_DATABASE_URL"), os.Getenv("ORQUESTRADOR_TEST_AMQP_URL"), os.Getenv("ORQUESTRADOR_TEST_AMQP_ANIMAIS_URL")
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
	if _, _, err := repo.Criar(ctx, repositorio.NovoUUID(), repositorio.NovaSaga{ID: id, AdotanteID: "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55", AnimalID: "65a2f1c4e8b9d3a7f0c1b2e9"}); err != nil {
		t.Fatal(err)
	}
	go Novo(repo, silencioso, FilaRespostas).Rodar(ctx, amqpURL)

	conn, err := amqp.Dial(animaisURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	canal, _ := conn.Channel()
	publicar := func(c []byte) {
		if err := canal.PublishWithContext(ctx, "ampara.respostas", "orquestrador", true, false, amqp.Publishing{ContentType: "application/json", Body: c}); err != nil {
			t.Fatal(err)
		}
	}
	estado := func() (e string, transicoes2 int) {
		_ = pool.QueryRow(ctx, `SELECT estado FROM sagas WHERE id = $1`, id).Scan(&e)
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
		t.Fatal("a resposta não levou a SAGA a ANIMAL_RESERVADO")
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
		q, err := cAdmin.QueueDeclarePassive("orquestrador.respostas.dlq", true, false, false, false, amqp.Table{"x-queue-type": "quorum"})
		return err == nil && q.Messages >= 1
	}) {
		t.Fatal("a mensagem inválida não chegou à orquestrador.respostas.dlq")
	}
}

func TestAlertaDLQRegistraUmaVezSemTirarDaFila(t *testing.T) {
	amqpURL, adminURL := os.Getenv("ORQUESTRADOR_TEST_AMQP_URL"), os.Getenv("ORQUESTRADOR_TEST_AMQP_ADMIN_URL")
	if amqpURL == "" || adminURL == "" {
		t.Skip("variáveis de integração não definidas")
	}
	admin, err := amqp.Dial(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	canal, _ := admin.Channel()
	filaDLQ := FilaRespostas + ".dlq"
	_, _ = canal.QueuePurge(filaDLQ, false)
	_, _ = canal.QueuePurge(FilaSolicitacoes+".dlq", false)
	_, _ = canal.QueuePurge(FilaRespostas, false)
	// duas mensagens mortas de verdade: publicadas na fila de origem e rejeitadas sem requeue,
	// para o próprio RabbitMQ preencher o x-death (cliente não consegue forjar esse cabeçalho)
	for i, id := range []string{"aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"} {
		if err := canal.PublishWithContext(context.Background(), "ampara.respostas", "orquestrador", false, false, amqp.Publishing{
			MessageId: id, Type: "AnimalReservado", Body: corpo(id, "AnimalReservado", fmt.Sprintf("saga-%d", i), `{}`, 9),
		}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		var m amqp.Delivery
		var ok bool
		for tentativa := 0; tentativa < 50 && !ok; tentativa++ {
			m, ok, _ = canal.Get(FilaRespostas, false)
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
		if q, err := canal.QueueDeclarePassive(filaDLQ, true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); err == nil && q.Messages == 2 {
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
	if strings.Count(logs.String(), `"level":"ERROR"`) != 2 || !strings.Contains(logs.String(), `"filaDeOrigem":"orquestrador.respostas"`) ||
		!strings.Contains(logs.String(), `"sagaId":"saga-0"`) {
		t.Fatalf("logs: %s", logs.String())
	}
	// a contagem da quorum queue leva um instante para refletir o nack com requeue
	var q amqp.Queue
	for i := 0; i < 50; i++ {
		if q, err = canal.QueueDeclarePassive(filaDLQ, true, false, false, false, amqp.Table{"x-queue-type": "quorum"}); err == nil && q.Messages == 2 {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("as mensagens deveriam continuar na DLQ: %d (%v)", q.Messages, err)
}
