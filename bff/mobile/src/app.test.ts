import { test } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "./app.js";
import type { Config } from "./config.js";
import type { Cliente } from "./cliente.js";

const config: Config = { porta: 3020, timeoutMs: 30, jwtPublicKey: "", servicos: {
  animais: "http://animais", adocao: "http://adocao", identidade: "http://identidade",
  notificacoes: "http://notificacoes", assistente: "http://assistente",
} };
function app(chamar: Cliente) {
  return criarApp({ config, logger: false, chamar, verificar: async token => {
    if (token === "ong") return { sub: "ong", role: "ONG" };
    if (token === "adotante") return { sub: "adotante", role: "ADOTANTE" };
    throw new Error("token inválido");
  } });
}
test("busca pública preserva filtros e expõe a réplica do Animais", async t => {
  const servidor = app(async (url, req) => {
    assert.equal(url, "http://animais/v1/animais/busca?lat=-21&lng=-45&raioKm=10");
    assert.equal(req.id, "correlacao");
    return Response.json({ itens: [] }, { headers: { "X-Served-By": "animais-2" } });
  });
  t.after(() => servidor.close());
  const response = await servidor.inject({ url: "/mobile/v1/animais?lat=-21&lng=-45&raioKm=10", headers: { "X-Correlation-Id": "correlacao" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-animais-served-by"], "animais-2");
  assert.ok(response.headers["x-served-by"]);
});
test("rotas privadas exigem adotante e POST não herda acesso público", async t => {
  const servidor = app(async () => Response.json({}));
  t.after(() => servidor.close());
  assert.equal((await servidor.inject("/mobile/v1/health")).statusCode, 401);
  assert.equal((await servidor.inject({ url: "/mobile/v1/health", headers: { authorization: "Bearer ong" } })).statusCode, 403);
  assert.equal((await servidor.inject({ url: "/mobile/v1/health", headers: { authorization: "Bearer adotante" } })).statusCode, 200);
  assert.equal((await servidor.inject({ method: "POST", url: "/mobile/v1/animais" })).statusCode, 401);
});
test("ready verifica cinco serviços e identifica falha", async t => {
  const urls: string[] = [];
  const servidor = app(async url => {
    urls.push(url);
    return Response.json({}, { status: url.includes("assistente") ? 503 : 200 });
  });
  t.after(() => servidor.close());
  const response = await servidor.inject("/ready");
  assert.equal(response.statusCode, 503);
  assert.equal(urls.length, 5);
  assert.equal(response.json<{dependencias: Record<string,string>}>().dependencias.assistente, "indisponivel");
});
test("timeout vira 504 e falha de conexão vira 502", async t => {
  const servidor = app(async url => { throw new DOMException("lento", url.includes("busca") ? "TimeoutError" : "Error"); });
  t.after(() => servidor.close());
  assert.equal((await servidor.inject("/mobile/v1/animais")).statusCode, 504);
});
