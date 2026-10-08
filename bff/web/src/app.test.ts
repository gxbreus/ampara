import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { exportSPKI, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { criarApp } from "./app.js";
import { criarVerificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";

const config: Config = {
  porta: 3010,
  timeoutMs: 3000,
  jwtPublicKey: "",
  servicos: { identidade: "http://identidade:3001", animais: "http://animais:8001", adocao: "http://adocao:8080" },
};

let privada: KeyLike;
let outraPrivada: KeyLike;
let publicaPem: string;

before(async () => {
  const minha = await generateKeyPair("RS256");
  privada = minha.privateKey;
  publicaPem = await exportSPKI(minha.publicKey);
  outraPrivada = (await generateKeyPair("RS256")).privateKey;
});
function token(role: string, chave = privada, emissor = "ampara-identidade") {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("c50a83ab-7db0-41b4-9436-4144c36f97d5")
    .setIssuer(emissor)
    .setExpirationTime("1h")
    .sign(chave);
}

// Cliente falso: registra as chamadas e responde conforme o mapa url -> status.
function clienteFalso(respostas: Record<string, number | Error>) {
  const chamadas: { url: string; cabecalhos: Headers }[] = [];
  const chamar: Cliente = async (url, req) => {
    const cabecalhos = new Headers({ "X-Correlation-Id": req.id });
    if (req.headers.authorization) cabecalhos.set("Authorization", req.headers.authorization);
    chamadas.push({ url, cabecalhos });
    const r = respostas[url] ?? 200;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify({ ok: true }), { status: r, headers: { "content-type": "application/json" } });
  };
  return { chamar, chamadas };
}

async function app(respostas: Record<string, number | Error> = {}) {
  const falso = clienteFalso(respostas);
  const instancia = criarApp({ config, verificar: await criarVerificador(publicaPem), chamar: falso.chamar, logger: false });
  return { instancia, chamadas: falso.chamadas };
}

describe("health e cabeçalhos", () => {
  it("responde 200 em /web/v1/health com X-Served-By e X-Correlation-Id", async () => {
    const { instancia } = await app();
    const r = await instancia.inject({ url: "/web/v1/health", headers: { "x-correlation-id": "c-123" } });
    assert.equal(r.statusCode, 200);
    assert.ok(r.headers["x-served-by"]);
    assert.equal(r.headers["x-correlation-id"], "c-123");
  });

  it("não responde fora do prefixo /web/v1", async () => {
    const { instancia } = await app();
    assert.equal((await instancia.inject({ url: "/health" })).statusCode, 404);
  });
});

describe("ready", () => {
  it("responde 200 quando os três serviços respondem", async () => {
    const { instancia } = await app();
    const r = await instancia.inject({ url: "/web/v1/ready" });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json<{ dependencias: Record<string, string> }>().dependencias, { identidade: "ok", animais: "ok", adocao: "ok" });
  });

  it("responde 503 e diz qual serviço está fora", async () => {
    const { instancia } = await app({
      "http://animais:8001/health": new Error("timeout"),
      "http://adocao:8080/health": 503,
    });
    const r = await instancia.inject({ url: "/web/v1/ready" });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.json<{ dependencias: Record<string, string> }>().dependencias, { identidade: "ok", animais: "indisponivel", adocao: "indisponivel" });
  });

  it("repassa o X-Correlation-Id para os serviços chamados", async () => {
    const { instancia, chamadas } = await app();
    await instancia.inject({ url: "/web/v1/ready", headers: { "x-correlation-id": "c-propagado" } });
    assert.equal(chamadas.length, 3);
    for (const c of chamadas) assert.equal(c.cabecalhos.get("X-Correlation-Id"), "c-propagado");
  });
});

describe("autenticação e role em /web/v1/eu", () => {
  it("401 sem token", async () => {
    const { instancia } = await app();
    assert.equal((await instancia.inject({ url: "/web/v1/eu" })).statusCode, 401);
  });

  it("401 com token assinado por outra chave", async () => {
    const { instancia } = await app();
    const r = await instancia.inject({ url: "/web/v1/eu", headers: { authorization: `Bearer ${await token("ONG", outraPrivada)}` } });
    assert.equal(r.statusCode, 401);
  });

  it("401 com emissor diferente de ampara-identidade", async () => {
    const { instancia } = await app();
    const r = await instancia.inject({ url: "/web/v1/eu", headers: { authorization: `Bearer ${await token("ONG", privada, "outro")}` } });
    assert.equal(r.statusCode, 401);
  });

  it("403 com token de ADOTANTE", async () => {
    const { instancia } = await app();
    const r = await instancia.inject({ url: "/web/v1/eu", headers: { authorization: `Bearer ${await token("ADOTANTE")}` } });
    assert.equal(r.statusCode, 403);
    assert.equal(r.headers["content-type"], "application/problem+json; charset=utf-8");
  });

  for (const role of ["PROTETOR", "ONG", "ADMIN"]) {
    it(`repassa a chamada à Identidade com o Authorization original para ${role}`, async () => {
      const { instancia, chamadas } = await app();
      const t = await token(role);
      const r = await instancia.inject({ url: "/web/v1/eu", headers: { authorization: `Bearer ${t}` } });
      assert.equal(r.statusCode, 200);
      assert.equal(chamadas[0].url, "http://identidade:3001/v1/contas/eu");
      assert.equal(chamadas[0].cabecalhos.get("Authorization"), `Bearer ${t}`);
    });
  }

  it("503 quando a Identidade não responde", async () => {
    const { instancia } = await app({ "http://identidade:3001/v1/contas/eu": new Error("ECONNREFUSED") });
    const r = await instancia.inject({ url: "/web/v1/eu", headers: { authorization: `Bearer ${await token("ONG")}` } });
    assert.equal(r.statusCode, 503);
  });
});
