import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { exportSPKI, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { connect } from "amqplib";
import { criarApp } from "./app.js";
import { criarVerificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { consumirEventos, decodificar, destinatario, Hub, type Evento } from "./eventos.js";

const ong = "c50a83ab-7db0-41b4-9436-4144c36f97d5";
const outraOng = "0b0b0b0b-1111-4222-8333-444444444444";
const config: Config = {
  porta: 0,
  timeoutMs: 3000,
  jwtPublicKey: "",
  servicos: { identidade: "http://identidade:3001", animais: "http://animais:8001", adocao: "http://adocao:8080" },
};
const semServicos: Cliente = async () => new Response(null, { status: 404 });

let privada: KeyLike;
let publicaPem: string;
before(async () => {
  const par = await generateKeyPair("RS256");
  privada = par.privateKey;
  publicaPem = await exportSPKI(par.publicKey);
});
const token = (sub: string, role = "ONG") =>
  new SignJWT({ role }).setProtectedHeader({ alg: "RS256" }).setSubject(sub).setIssuer("ampara-identidade").setExpirationTime("1h").sign(privada);

const evento = (id: string, tipo: string, dados: Record<string, unknown>): Evento => ({ id, tipo, ocorridoEm: "2026-11-17T15:00:00Z", dados });
const envelope = (messageId: string, type: string, payload: unknown, version = 1) =>
  Buffer.from(JSON.stringify({ messageId, type, version, correlationId: "c", sagaId: null, occurredAt: "2026-11-17T15:00:00Z", payload }));

describe("decodificar e destinatario", () => {
  it("lê o envelope do catálogo e ignora versão desconhecida ou JSON quebrado", () => {
    const e = decodificar(envelope("m1", "adocao.aprovada", { responsavelId: ong }));
    assert.deepEqual(e, { id: "m1", tipo: "adocao.aprovada", ocorridoEm: "2026-11-17T15:00:00Z", dados: { responsavelId: ong } });
    assert.equal(decodificar(envelope("m2", "adocao.aprovada", {}, 2)), null);
    assert.equal(decodificar(Buffer.from("{")), null);
  });

  it("o dono é o responsável pelo animal", () => {
    assert.equal(destinatario({ tipo: "adocao.aguardando_aprovacao", dados: { responsavelId: ong } }), ong);
    assert.equal(destinatario({ tipo: "animal.status_alterado", dados: { responsavel: { id: ong, nome: "ONG" } } }), ong);
    // falhou antes da reserva: ainda não há responsável
    assert.equal(destinatario({ tipo: "adocao.falhou", dados: { responsavelId: null } }), null);
    assert.equal(destinatario({ tipo: "conta.verificada", dados: { contaId: ong } }), null);
  });
});

describe("Hub", () => {
  it("entrega só às conexões do dono, uma vez por messageId, e para de entregar ao desconectar", () => {
    const hub = new Hub();
    const minhas: string[] = [];
    const deOutra: string[] = [];
    const sair = hub.conectar(ong, (t) => minhas.push(t));
    hub.conectar(outraOng, (t) => deOutra.push(t));

    assert.equal(hub.entregar(evento("m1", "adocao.aguardando_aprovacao", { responsavelId: ong })), 1);
    assert.equal(hub.entregar(evento("m1", "adocao.aguardando_aprovacao", { responsavelId: ong })), 0); // repetida
    assert.equal(minhas.length, 1);
    assert.equal(deOutra.length, 0);
    assert.match(minhas[0], /^id: m1\nevent: adocao\.aguardando_aprovacao\ndata: \{.*\}\n\n$/);

    sair();
    assert.equal(hub.entregar(evento("m2", "adocao.concluida", { responsavelId: ong })), 0);
    assert.equal(hub.abertas, 1);
  });
});

// Lê o stream SSE até aparecer o trecho esperado (ou estourar o prazo).
async function lerAte(resp: Response, trecho: string, prazoMs = 3000): Promise<string> {
  const leitor = resp.body!.getReader();
  const dec = new TextDecoder();
  let texto = "";
  const fim = Date.now() + prazoMs;
  while (!texto.includes(trecho) && Date.now() < fim) {
    const { value, done } = await Promise.race([
      leitor.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), fim - Date.now())),
    ]);
    if (done) break;
    texto += dec.decode(value, { stream: true });
  }
  leitor.releaseLock();
  return texto;
}

describe("GET /web/v1/eventos", () => {
  it("abre o stream e recebe os eventos do próprio responsável", async () => {
    const hub = new Hub();
    const app = criarApp({ config, verificar: await criarVerificador(publicaPem), chamar: semServicos, hub, logger: false });
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const controle = new AbortController();
    try {
      const resp = await fetch(`${base}/web/v1/eventos`, { headers: { authorization: `Bearer ${await token(ong)}` }, signal: controle.signal });
      assert.equal(resp.status, 200);
      assert.match(resp.headers.get("content-type") ?? "", /^text\/event-stream/);
      assert.match(await lerAte(resp, ": conectado"), /retry: 3000/);

      hub.entregar(evento("m-outra", "adocao.aprovada", { responsavelId: outraOng }));
      hub.entregar(evento("m-minha", "adocao.aguardando_aprovacao", { responsavelId: ong, solicitacaoId: "s1" }));
      const texto = await lerAte(resp, "m-minha");
      assert.match(texto, /event: adocao\.aguardando_aprovacao/);
      assert.ok(!texto.includes("m-outra"), "evento de outra ONG não pode chegar");
    } finally {
      controle.abort();
      await app.close();
    }
  });

  it("401 sem token e 403 para ADOTANTE", async () => {
    const app = criarApp({ config, verificar: await criarVerificador(publicaPem), chamar: semServicos, hub: new Hub(), logger: false });
    assert.equal((await app.inject({ url: "/web/v1/eventos" })).statusCode, 401);
    const r = await app.inject({ url: "/web/v1/eventos", headers: { authorization: `Bearer ${await token(ong, "ADOTANTE")}` } });
    assert.equal(r.statusCode, 403);
  });

  it("503 quando o BFF sobe sem RabbitMQ", async () => {
    const app = criarApp({ config, verificar: await criarVerificador(publicaPem), chamar: semServicos, logger: false });
    const r = await app.inject({ url: "/web/v1/eventos", headers: { authorization: `Bearer ${await token(ong)}` } });
    assert.equal(r.statusCode, 503);
  });
});

// Integração: BFF_WEB_TEST_AMQP_URL (usuário bff-web) e BFF_WEB_TEST_AMQP_ADMIN_URL (publica
// no lugar do Orquestrador). Sem elas, o teste é pulado.
describe("consumo do RabbitMQ", () => {
  const url = process.env.BFF_WEB_TEST_AMQP_URL;
  const adminUrl = process.env.BFF_WEB_TEST_AMQP_ADMIN_URL;
  let parar: (() => Promise<void>) | undefined;
  after(async () => parar?.());

  it("recebe adocao.* e animal.* numa fila própria e entrega ao dono", { skip: !url || !adminUrl }, async () => {
    const hub = new Hub();
    const recebidos: string[] = [];
    hub.conectar(ong, (t) => recebidos.push(t));
    const log = { info() {}, warn() {}, debug() {}, error() {} } as unknown as Parameters<typeof consumirEventos>[2];
    parar = consumirEventos(url!, hub, log);
    await new Promise((r) => setTimeout(r, 1000)); // fila criada e ligada

    const admin = await connect(adminUrl!);
    const canal = await admin.createChannel();
    canal.publish("ampara.eventos", "adocao.aguardando_aprovacao", envelope("i1", "adocao.aguardando_aprovacao", { responsavelId: ong }));
    canal.publish("ampara.eventos", "animal.status_alterado", envelope("i2", "animal.status_alterado", { responsavel: { id: ong } }));
    canal.publish("ampara.eventos", "conta.verificada", envelope("i3", "conta.verificada", { contaId: ong }));
    await canal.close();
    await admin.close();

    for (let i = 0; i < 30 && recebidos.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(recebidos.length, 2);
    assert.match(recebidos.join(""), /adocao\.aguardando_aprovacao[\s\S]*animal\.status_alterado/);
  });
});
