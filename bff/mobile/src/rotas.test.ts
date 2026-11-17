import { test } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "./app.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";

const config: Config = { porta: 3020, timeoutMs: 50, jwtPublicKey: "", servicos: {
  animais: "http://animais", adocao: "http://adocao", identidade: "http://identidade",
  notificacoes: "http://notificacoes", assistente: "http://assistente",
} };
const ID = "6706e21b7a2d4b8e2194cf01";
const SOL = "c50a83ab-7db0-41b4-9436-4144c36f97d5";
const headers = { authorization: "Bearer adotante" };
const animal = { id: ID, nome: "Thor", fotoThumb: "https://a.dev/t.webp", porte: "MEDIO", distanciaKm: 2.4,
  cidade: "Lavras", atualizadoEm: "2026-11-17T12:00:00Z", endereco: "PRIVADO", historicoStatus: ["privado"],
  responsavel: { id: SOL, nome: "Patas", verificado: true, email: "privado" } };
function servidor(chamar: Cliente) {
  return criarApp({ config, chamar, logger: false, verificar: async token => {
    if (token !== "adotante") throw new Error("inválido");
    return { sub: "eu", role: "ADOTANTE" };
  } });
}
test("20 cards têm 8 campos, uma consulta de adoção e payload menor que 6 KB", async t => {
  let chamadas = 0;
  const app = servidor(async url => {
    if (url.startsWith("http://adocao")) {
      chamadas++;
      assert.equal(new URL(url).searchParams.get("adotanteId"), "eu");
      return Response.json({ _embedded: { solicitacoes: [{ id: SOL, animalId: ID, estado: "ANIMAL_RESERVADO" }] } });
    }
    return Response.json({ itens: Array.from({ length: 20 }, (_, i) => ({ ...animal, id: i === 0 ? ID : String(i) })) });
  });
  t.after(() => app.close());
  const r = await app.inject({ url: "/mobile/v1/animais?lat=0&lng=0", headers });
  assert.equal(r.statusCode, 200);
  const body = r.json<{ itens: Record<string, unknown>[] }>();
  assert.equal(Object.keys(body.itens[0]).length, 8);
  assert.deepEqual(body.itens[0].minhaSolicitacao, { id: SOL, estado: "ANIMAL_RESERVADO" });
  assert.equal(chamadas, 1);
  assert.ok(Buffer.byteLength(r.body) < 6000, String(Buffer.byteLength(r.body)));
  assert.ok(!r.body.includes("PRIVADO"));
});
test("busca anônima não chama Adoção; token inválido recebe 401", async t => {
  const app = servidor(async url => {
    assert.ok(!url.startsWith("http://adocao"));
    return Response.json({ itens: [animal] });
  });
  t.after(() => app.close());
  const r = await app.inject("/mobile/v1/animais");
  assert.equal(r.json<{itens: {minhaSolicitacao: null}[]}>().itens[0].minhaSolicitacao, null);
  assert.equal((await app.inject({ url: "/mobile/v1/animais", headers: { authorization: "Bearer falso" } })).statusCode, 401);
});
test("Adoção indisponível degrada a busca e detalhe filtra dados privados", async t => {
  const app = servidor(async url => {
    if (url.startsWith("http://adocao")) throw new Error("offline");
    return Response.json(url.endsWith(ID) ? animal : { itens: [animal] });
  });
  t.after(() => app.close());
  const r = await app.inject({ url: "/mobile/v1/animais", headers });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json<{avisos: string[]}>().avisos.length, 1);
  const detalhe = await app.inject(`/mobile/v1/animais/${ID}`);
  assert.ok(!detalhe.body.includes("privado"));
  assert.ok(!detalhe.body.includes("endereco"));
});
test("criação preserva idempotência e traduz Location e links", async t => {
  const app = servidor(async (url, _req, init) => {
    assert.equal(url, "http://adocao/v1/solicitacoes");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "pedido-1");
    return Response.json({ id: SOL, animalId: ID, estado: "SOLICITADA", criadoEm: "agora", _links: {} }, { status: 202 });
  });
  t.after(() => app.close());
  const r = await app.inject({ method: "POST", url: "/mobile/v1/solicitacoes", headers: { ...headers, "idempotency-key": "pedido-1" }, payload: { animalId: ID } });
  assert.equal(r.statusCode, 202);
  assert.equal(r.headers.location, `/mobile/v1/solicitacoes/${SOL}`);
});
test("lista força o adotante do JWT e hidrata animais em lote", async t => {
  let lotes = 0;
  const app = servidor(async url => {
    if (url.startsWith("http://adocao")) {
      assert.equal(new URL(url).searchParams.get("adotanteId"), "eu");
      return Response.json({ _embedded: { solicitacoes: [{ id: SOL, animalId: ID, _links: {} }] }, _links: {} });
    }
    lotes++; return Response.json({ itens: [{ ...animal, fotos: [animal.fotoThumb] }] });
  });
  t.after(() => app.close());
  const r = await app.inject({ url: "/mobile/v1/solicitacoes?adotanteId=outro", headers });
  assert.equal(r.statusCode, 200);
  assert.equal(lotes, 1);
});
test("solicitação alheia não expõe histórico nem permite cancelar", async t => {
  const app = servidor(async url => {
    assert.ok(!url.endsWith("historico") && !url.endsWith("cancelamento"));
    return Response.json({ adotanteId: "outro" });
  });
  t.after(() => app.close());
  for (const [method, suffix] of [["GET", ""], ["GET", "/linha-do-tempo"], ["POST", "/cancelamento"]] as const) {
    assert.equal((await app.inject({ method, url: `/mobile/v1/solicitacoes/${SOL}${suffix}`, headers })).statusCode, 403);
  }
});
test("cancelar depende do link mesmo em estado inesperado", async t => {
  let posts = 0;
  const app = servidor(async (_url, _req, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({ id: SOL, adotanteId: "eu", estado: "ESTADO_FUTURO", _links: { cancelar: { href: "/v1/x" } } });
  });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: `/mobile/v1/solicitacoes/${SOL}/cancelamento`, headers })).statusCode, 202);
  assert.equal(posts, 1);
});
test("sem link cancelar recebe 409 sem POST upstream", async t => {
  const app = servidor(async (_url, _req, init) => {
    assert.ok(!init?.method);
    return Response.json({ id: SOL, adotanteId: "eu", estado: "AGUARDANDO_APROVACAO", _links: {} });
  });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: `/mobile/v1/solicitacoes/${SOL}/cancelamento`, headers })).statusCode, 409);
});
test("assistente offline devolve fallback e recebe prazo de 20 segundos", async t => {
  const app = servidor(async (_url, _req, init) => {
    assert.ok(init?.signal); throw new DOMException("offline", "TimeoutError");
  });
  t.after(() => app.close());
  for (const acao of ["perguntas", "recomendacoes"]) {
    const r = await app.inject({ method: "POST", url: `/mobile/v1/assistente/${acao}`, headers, payload: { pergunta: "oi" } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json<{degradado: boolean}>().degradado, true);
  }
});
