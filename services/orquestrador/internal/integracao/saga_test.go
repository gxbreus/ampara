// Teste de integração da SAGA: PostgreSQL e RabbitMQ reais, o Orquestrador inteiro rodando
// no processo (relay do outbox, os dois consumidores e o verificador de prazos), a Adoção
// simulada publicando solicitacao.* e participantes simulados que respondem como o
// catálogo define.
//
// Variáveis: ORQUESTRADOR_TEST_DATABASE_URL, ORQUESTRADOR_TEST_AMQP_URL (usuário
// orquestrador) e ORQUESTRADOR_TEST_AMQP_ADMIN_URL (usuário admin, que simula a Adoção e os
// participantes e limpa as filas).
package integracao

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/gxbreus/ampara/services/orquestrador/internal/consumidor"
	"github.com/gxbreus/ampara/services/orquestrador/internal/db"
	"github.com/gxbreus/ampara/services/orquestrador/internal/outbox"
	"github.com/gxbreus/ampara/services/orquestrador/internal/prazos"
	"github.com/gxbreus/ampara/services/orquestrador/internal/repositorio"
	"github.com/gxbreus/ampara/services/orquestrador/internal/saga"
)

var silencioso = slog.New(slog.NewTextHandler(io.Discard, nil))

// comportamento dos participantes simulados
type cenario struct {
	perfilIncompleto bool
	animalReservado  bool
	identidadeFora   bool
	replicas         int // instâncias do orquestrador (padrão 1)
}

type participantes struct {
	mu          sync.Mutex
	reservas    map[string]string // animalId -> sagaId
	vagas       map[string]string // adotanteId -> sagaId
	recebidos   []string
	compensadas map[string]bool
}

type ambiente struct {
	pool  *pgxpool.Pool
	repo  *repositorio.Repositorio
	part  *participantes
	admin *amqp.Connection
	// canal da Adoção simulada, que publica solicitacao.*
	adocao *amqp.Channel
	c      cenario
	// pausa do participante Animais: cancelar o contexto para de consumir
	pararAnimais context.CancelFunc
}

func preparar(t *testing.T, c cenario) *ambiente {
	t.Helper()
	dbURL, amqpURL, adminURL := os.Getenv("ORQUESTRADOR_TEST_DATABASE_URL"), os.Getenv("ORQUESTRADOR_TEST_AMQP_URL"), os.Getenv("ORQUESTRADOR_TEST_AMQP_ADMIN_URL")
	if dbURL == "" || amqpURL == "" || adminURL == "" {
		t.Skip("variáveis de integração não definidas")
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	pool, err := db.Conectar(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, _ = pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	if err := db.Migrar(dbURL); err != nil {
		t.Fatal(err)
	}

	admin, err := amqp.Dial(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	limpeza, _ := admin.Channel()
	for _, f := range []string{"animais.comandos", "identidade.comandos", "orquestrador.respostas", "orquestrador.solicitacoes",
		"adocao.saga", "notificacoes.eventos", "animais.projecao"} {
		_, _ = limpeza.QueuePurge(f, false)
	}

	repo := repositorio.Novo(pool, repositorio.Config{TimeoutPasso: time.Second, PrazoDecisao: time.Hour, MaxReenvios: 5})
	for i := 0; i < max(c.replicas, 1); i++ {
		// cada réplica tem o próprio relay, consumidor e verificador, sobre o mesmo banco e a mesma fila
		pub := outbox.NovoPublicadorAMQP(amqpURL)
		t.Cleanup(pub.Fechar)
		relay := outbox.NovoRelay(pool, pub, silencioso)
		relay.Intervalo = 50 * time.Millisecond
		verif := prazos.Novo(repo, silencioso)
		verif.Intervalo = 100 * time.Millisecond
		go relay.Rodar(ctx)
		go consumidor.Novo(repo, silencioso, consumidor.FilaSolicitacoes).Rodar(ctx, amqpURL)
		go consumidor.Novo(repo, silencioso, consumidor.FilaRespostas).Rodar(ctx, amqpURL)
		go verif.Rodar(ctx)
	}

	p := &participantes{reservas: map[string]string{}, vagas: map[string]string{}, compensadas: map[string]bool{}}
	adocao, err := admin.Channel()
	if err != nil {
		t.Fatal(err)
	}
	a := &ambiente{pool: pool, repo: repo, part: p, admin: admin, adocao: adocao, c: c}
	a.ligarAnimais(ctx, t)
	if !c.identidadeFora {
		go p.rodar(ctx, t, admin, "identidade.comandos", func(cmd comando) (string, map[string]any) { return p.identidade(cmd, c) })
	}
	return a
}

func (a *ambiente) ligarAnimais(ctx context.Context, t *testing.T) {
	ctxAnimais, parar := context.WithCancel(ctx)
	a.pararAnimais = parar
	go a.part.rodar(ctxAnimais, t, a.admin, "animais.comandos", func(cmd comando) (string, map[string]any) { return a.part.animais(cmd, a.c) })
}

type comando struct {
	MessageID     string         `json:"messageId"`
	Type          string         `json:"type"`
	SagaID        string         `json:"sagaId"`
	CorrelationID string         `json:"correlationId"`
	Payload       map[string]any `json:"payload"`
}

func (p *participantes) rodar(ctx context.Context, t *testing.T, conn *amqp.Connection, fila string, tratar func(comando) (string, map[string]any)) {
	canal, err := conn.Channel()
	if err != nil {
		t.Error(err)
		return
	}
	defer canal.Close() // ao parar, as mensagens não confirmadas voltam para a fila
	entregas, err := canal.ConsumeWithContext(ctx, fila, "", false, false, false, false, nil)
	if err != nil {
		t.Error(err)
		return
	}
	for d := range entregas {
		var cmd comando
		_ = json.Unmarshal(d.Body, &cmd)
		tipo, payload := tratar(cmd)
		corpo, _ := json.Marshal(map[string]any{"messageId": repositorio.NovoUUID(), "type": tipo, "version": 1,
			"correlationId": cmd.CorrelationID, "sagaId": cmd.SagaID, "occurredAt": time.Now().UTC().Format(time.RFC3339), "payload": payload})
		_ = canal.PublishWithContext(ctx, "ampara.respostas", "orquestrador", false, false, amqp.Publishing{ContentType: "application/json", Body: corpo})
		_ = d.Ack(false)
	}
}

func (p *participantes) animais(cmd comando, c cenario) (string, map[string]any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.recebidos = append(p.recebidos, cmd.Type)
	animal := cmd.Payload["animalId"].(string)
	switch cmd.Type {
	case "ReservarAnimal":
		if c.animalReservado || p.compensadas[cmd.SagaID] {
			return "ReservaRecusada", map[string]any{"animalId": animal, "motivo": "INDISPONIVEL"}
		}
		p.reservas[animal] = cmd.SagaID
		return "AnimalReservado", map[string]any{"animalId": animal, "responsavelId": "c50a83ab-7db0-41b4-9436-4144c36f97d5", "animalNome": "Thor"}
	case "LiberarReserva":
		p.compensadas[cmd.SagaID] = true
		liberou := p.reservas[animal] == cmd.SagaID
		delete(p.reservas, animal)
		return "ReservaLiberada", map[string]any{"animalId": animal, "liberou": liberou}
	default: // ConfirmarAdocao
		return "AdocaoConfirmada", map[string]any{"animalId": animal}
	}
}

func (p *participantes) identidade(cmd comando, c cenario) (string, map[string]any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.recebidos = append(p.recebidos, cmd.Type)
	adotante := cmd.Payload["adotanteId"].(string)
	switch cmd.Type {
	case "ValidarPerfil":
		if c.perfilIncompleto {
			return "PerfilRecusado", map[string]any{"adotanteId": adotante, "motivo": "PERFIL_INCOMPLETO", "camposFaltando": []string{"aceiteTermo"}}
		}
		p.vagas[adotante] = cmd.SagaID
		return "PerfilValidado", map[string]any{"adotanteId": adotante}
	case "LiberarVaga":
		delete(p.vagas, adotante)
		return "VagaLiberada", map[string]any{"adotanteId": adotante, "liberou": true}
	default: // RegistrarAdocao
		delete(p.vagas, adotante)
		return "AdocaoRegistrada", map[string]any{"adotanteId": adotante, "animalId": cmd.Payload["animalId"]}
	}
}

const (
	adotante = "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55"
	animal   = "65a2f1c4e8b9d3a7f0c1b2e9"
)

// publicarDaAdocao simula a Adoção publicando uma solicitacao.* pelo outbox dela.
func (a *ambiente) publicarDaAdocao(t *testing.T, tipo, id string, payload map[string]any) {
	t.Helper()
	payload["solicitacaoId"] = id
	corpo, _ := json.Marshal(map[string]any{"messageId": repositorio.NovoUUID(), "type": tipo, "version": 1,
		"correlationId": "c-" + t.Name(), "sagaId": id, "occurredAt": time.Now().UTC().Format(time.RFC3339), "payload": payload})
	if err := a.adocao.PublishWithContext(context.Background(), "ampara.eventos", tipo, true, false,
		amqp.Publishing{ContentType: "application/json", Body: corpo}); err != nil {
		t.Fatal(err)
	}
}

func (a *ambiente) criar(t *testing.T) string {
	id := repositorio.NovoUUID()
	a.publicarDaAdocao(t, "solicitacao.criada", id, map[string]any{"adotanteId": adotante, "animalId": animal})
	return id
}

func (a *ambiente) decidir(t *testing.T, id, decisao, motivo string) {
	p := map[string]any{"decisao": decisao, "decididaPor": "c50a83ab-7db0-41b4-9436-4144c36f97d5"}
	if motivo != "" {
		p["motivo"] = motivo
	}
	a.publicarDaAdocao(t, "solicitacao.decidida", id, p)
}

func (a *ambiente) esperar(t *testing.T, id string, estado saga.Estado, limite time.Duration) {
	t.Helper()
	fim := time.Now().Add(limite)
	var atual string
	for time.Now().Before(fim) {
		_ = a.pool.QueryRow(context.Background(), `SELECT estado FROM sagas WHERE id = $1`, id).Scan(&atual)
		if atual == string(estado) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("a SAGA ficou em %s, esperado %s", atual, estado)
}

// eventos publicados (já confirmados pelo broker) para Notificações, em ordem
func (a *ambiente) eventos(t *testing.T, id string) []string {
	time.Sleep(300 * time.Millisecond) // dá tempo ao relay
	rows, _ := a.pool.Query(context.Background(), `SELECT tipo FROM outbox WHERE saga_id = $1 AND tipo LIKE 'adocao.%' AND publicado_em IS NOT NULL ORDER BY id`, id)
	defer rows.Close()
	var tipos []string
	for rows.Next() {
		var tipo string
		_ = rows.Scan(&tipo)
		tipos = append(tipos, tipo)
	}
	return tipos
}

func (a *ambiente) transicoes(t *testing.T, id string) []int {
	rows, _ := a.pool.Query(context.Background(), `SELECT transicao FROM saga_historico WHERE saga_id = $1 AND transicao > 0 ORDER BY id`, id)
	defer rows.Close()
	var ns []int
	for rows.Next() {
		var n int
		_ = rows.Scan(&n)
		ns = append(ns, n)
	}
	return ns
}

// espelho: o que a Adoção recebeu em saga.transicao (versão e estado), em ordem
func (a *ambiente) espelho(t *testing.T, id string) ([]int, []string) {
	time.Sleep(300 * time.Millisecond) // dá tempo ao relay
	rows, _ := a.pool.Query(context.Background(), `SELECT (payload->'payload'->>'versao')::int, payload->'payload'->>'estado'
		FROM outbox WHERE saga_id = $1 AND tipo = 'saga.transicao' AND publicado_em IS NOT NULL ORDER BY id`, id)
	defer rows.Close()
	var versoes []int
	var estados []string
	for rows.Next() {
		var v int
		var e string
		_ = rows.Scan(&v, &e)
		versoes, estados = append(versoes, v), append(estados, e)
	}
	return versoes, estados
}

func iguais[T comparable](a, b []T) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestCaminhoFelizAteConcluida(t *testing.T) {
	a := preparar(t, cenario{})
	id := a.criar(t)
	inicio := time.Now()
	a.esperar(t, id, saga.AguardandoAprovacao, 5*time.Second)
	if d := time.Since(inicio); d > 3*time.Second {
		t.Errorf("chegou a AGUARDANDO_APROVACAO em %s; o critério é < 3 s", d)
	}
	a.decidir(t, id, "APROVADA", "")
	a.esperar(t, id, saga.Concluida, 5*time.Second)
	if got := a.transicoes(t, id); !iguais(got, []int{1, 2, 5, 8, 14, 15}) {
		t.Errorf("transições %v", got)
	}
	if got := a.eventos(t, id); !iguais(got, []string{"adocao.aguardando_aprovacao", "adocao.aprovada", "adocao.concluida"}) {
		t.Errorf("eventos %v", got)
	}
	versoes, estados := a.espelho(t, id)
	if !iguais(versoes, []int{1, 2, 3, 4, 5, 6}) ||
		!iguais(estados, []string{"SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA", "APROVADA", "CONCLUIDA"}) {
		t.Errorf("saga.transicao para a Adoção: versões %v, estados %v", versoes, estados)
	}
}

func TestPerfilIncompletoCompensaAReserva(t *testing.T) {
	a := preparar(t, cenario{perfilIncompleto: true})
	id := a.criar(t)
	a.esperar(t, id, saga.PerfilInvalido, 5*time.Second)
	if got := a.transicoes(t, id); !iguais(got, []int{1, 2, 6, 12}) {
		t.Errorf("transições %v (esperado passar por COMPENSANDO antes de PERFIL_INVALIDO)", got)
	}
	a.part.mu.Lock()
	reservado := a.part.reservas[animal]
	a.part.mu.Unlock()
	if reservado != "" {
		t.Error("o animal deveria ter voltado a ficar disponível")
	}
	if got := a.eventos(t, id); !iguais(got, []string{"adocao.falhou"}) {
		t.Errorf("eventos %v", got)
	}
}

func TestAnimalJaReservadoSemCompensacao(t *testing.T) {
	a := preparar(t, cenario{animalReservado: true})
	id := a.criar(t)
	a.esperar(t, id, saga.RejeitadaIndisponivel, 5*time.Second)
	a.part.mu.Lock()
	recebidos := append([]string(nil), a.part.recebidos...)
	a.part.mu.Unlock()
	if !iguais(recebidos, []string{"ReservarAnimal"}) {
		t.Errorf("os participantes receberam %v; nenhuma compensação deveria sair", recebidos)
	}
}

func TestIdentidadeForaDoAr(t *testing.T) {
	a := preparar(t, cenario{identidadeFora: true})
	id := a.criar(t)
	a.esperar(t, id, saga.Falhou, 8*time.Second)
	if got := a.transicoes(t, id); !iguais(got, []int{1, 2, 7, 12}) {
		t.Errorf("transições %v (timeout do T2, C1 bloqueante, FALHOU)", got)
	}
	var motivo string
	_ = a.pool.QueryRow(context.Background(), `SELECT motivo FROM sagas WHERE id = $1`, id).Scan(&motivo)
	if motivo != "TIMEOUT_T2" {
		t.Errorf("motivo %q", motivo)
	}
}

func TestRecusaEsperaAsDuasCompensacoes(t *testing.T) {
	a := preparar(t, cenario{})
	id := a.criar(t)
	a.esperar(t, id, saga.AguardandoAprovacao, 5*time.Second)
	a.decidir(t, id, "RECUSADA", "sem tela")
	a.esperar(t, id, saga.Recusada, 5*time.Second)
	if got := a.eventos(t, id); !iguais(got, []string{"adocao.aguardando_aprovacao", "adocao.recusada"}) {
		t.Errorf("eventos %v", got)
	}
	a.part.mu.Lock()
	defer a.part.mu.Unlock()
	if a.part.reservas[animal] != "" || a.part.vagas[adotante] != "" {
		t.Error("a reserva e a vaga deveriam ter sido liberadas")
	}
}

func TestCompensacaoComParticipanteForaDoArReenviaAteResponder(t *testing.T) {
	a := preparar(t, cenario{})
	id := a.criar(t)
	a.esperar(t, id, saga.AguardandoAprovacao, 5*time.Second)

	a.pararAnimais() // Animais sai do ar antes da recusa
	time.Sleep(200 * time.Millisecond)
	a.decidir(t, id, "RECUSADA", "")
	time.Sleep(3500 * time.Millisecond) // alguns timeouts de 1 s, com backoff

	var estado string
	var linhas, ids, tentativas int
	_ = a.pool.QueryRow(context.Background(), `SELECT estado FROM sagas WHERE id = $1`, id).Scan(&estado)
	_ = a.pool.QueryRow(context.Background(), `SELECT count(*), count(DISTINCT message_id) FROM outbox WHERE saga_id = $1 AND tipo = 'LiberarReserva'`, id).Scan(&linhas, &ids)
	_ = a.pool.QueryRow(context.Background(), `SELECT tentativas FROM saga_passos WHERE saga_id = $1 AND passo = 'C1'`, id).Scan(&tentativas)
	if estado != "COMPENSANDO" || linhas < 2 || ids != 1 || tentativas < 1 {
		t.Fatalf("com Animais fora: estado %s, %d LiberarReserva com %d messageId distintos, %d tentativas", estado, linhas, ids, tentativas)
	}

	a.ligarAnimais(context.Background(), t) // Animais volta
	a.esperar(t, id, saga.Recusada, 5*time.Second)
}

func TestDuasReplicasPublicamCadaComandoUmaVez(t *testing.T) {
	a := preparar(t, cenario{replicas: 2})
	id := a.criar(t)
	a.esperar(t, id, saga.AguardandoAprovacao, 5*time.Second)
	a.decidir(t, id, "APROVADA", "")
	a.esperar(t, id, saga.Concluida, 5*time.Second)
	time.Sleep(500 * time.Millisecond)
	a.part.mu.Lock()
	defer a.part.mu.Unlock()
	esperado := []string{"ReservarAnimal", "ValidarPerfil", "ConfirmarAdocao", "RegistrarAdocao"}
	contagem := map[string]int{}
	for _, r := range a.part.recebidos {
		contagem[r]++
	}
	for _, tipo := range esperado {
		if contagem[tipo] != 1 {
			t.Errorf("%s recebido %d vezes pelos participantes; esperado 1", tipo, contagem[tipo])
		}
	}
	if got := a.transicoes(t, id); !iguais(got, []int{1, 2, 5, 8, 14, 15}) {
		t.Errorf("transições %v", got)
	}
}

// #86: Animais falha na LiberarReserva (mensagem envenenada); o Orquestrador para no teto,
// marca a intervenção, e um ADMIN retoma depois da correção.
func TestTetoIntervencaoERetomada(t *testing.T) {
	a := preparar(t, cenario{})
	id := a.criar(t)
	a.esperar(t, id, saga.AguardandoAprovacao, 5*time.Second)

	a.pararAnimais() // o handler de Animais "quebrado": não responde
	time.Sleep(200 * time.Millisecond)
	a.decidir(t, id, "RECUSADA", "")
	// teto de 5 reenvios, com backoff a partir de 1 s (até ~31 s); espera a intervenção
	fim := time.Now().Add(60 * time.Second)
	var intervencao bool
	for time.Now().Before(fim) && !intervencao {
		_ = a.pool.QueryRow(context.Background(), `SELECT requer_intervencao FROM sagas WHERE id = $1`, id).Scan(&intervencao)
		time.Sleep(200 * time.Millisecond)
	}
	if !intervencao {
		t.Fatal("a solicitação deveria ter parado no teto e pedido intervenção")
	}
	// a Adoção fica sabendo pelo saga.transicao, que é o que alimenta a fila de intervenção dela
	var avisou bool
	_ = a.pool.QueryRow(context.Background(), `SELECT bool_or((payload->'payload'->>'requerIntervencao')::boolean)
		FROM outbox WHERE saga_id = $1 AND tipo = 'saga.transicao'`, id).Scan(&avisou)
	if !avisou {
		t.Fatal("algum saga.transicao deveria levar requerIntervencao = true à Adoção")
	}
	var status string
	var tentativas int
	_ = a.pool.QueryRow(context.Background(), `SELECT status, tentativas FROM saga_passos WHERE saga_id = $1 AND passo = 'C1'`, id).Scan(&status, &tentativas)
	if status != "ESGOTADO" || tentativas != 5 {
		t.Fatalf("C1: status %s, tentativas %d", status, tentativas)
	}
	// parado no teto, nada mais é reenviado
	var antes, depois int
	_ = a.pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE saga_id = $1 AND tipo = 'LiberarReserva'`, id).Scan(&antes)
	time.Sleep(2 * time.Second)
	_ = a.pool.QueryRow(context.Background(), `SELECT count(*) FROM outbox WHERE saga_id = $1 AND tipo = 'LiberarReserva'`, id).Scan(&depois)
	if antes != depois {
		t.Fatalf("depois do teto, a LiberarReserva não deveria ser reenviada (%d -> %d)", antes, depois)
	}

	// a causa foi corrigida: Animais volta, e o ADMIN retoma
	_, _ = a.admin.Channel() // mantém a conexão de admin viva
	if q, err := mustCanal(t, a).QueuePurge("animais.comandos", false); err != nil {
		t.Fatalf("limpar a fila (%d): %v", q, err)
	}
	a.ligarAnimais(context.Background(), t)
	a.publicarDaAdocao(t, "solicitacao.retomada", id, map[string]any{"pedidaPor": "ad000000-0000-4000-8000-000000000001"})
	a.esperar(t, id, saga.Recusada, 10*time.Second)
	var ids int
	_ = a.pool.QueryRow(context.Background(), `SELECT count(DISTINCT message_id) FROM outbox WHERE saga_id = $1 AND tipo = 'LiberarReserva'`, id).Scan(&ids)
	if ids != 1 {
		t.Fatalf("a retomada deveria reenviar com o mesmo messageId: %d ids distintos", ids)
	}
}


func mustCanal(t *testing.T, a *ambiente) *amqp.Channel {
	c, err := a.admin.Channel()
	if err != nil {
		t.Fatal(err)
	}
	return c
}
