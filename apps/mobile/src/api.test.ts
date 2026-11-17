/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, configurarSessao, ErroApi } from "./api";

test("API usa só gateway, preserva token/idempotência e trata sessão expirada", async (t) => {
  const original = globalThis.fetch;
  process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.20:8000/";
  let expirou = false;
  configurarSessao("token-de-teste", () => {
    expirou = true;
  });
  t.after(() => {
    globalThis.fetch = original;
    configurarSessao(null, () => {});
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "http://192.168.1.20:8000/mobile/v1/solicitacoes");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer token-de-teste",
    );
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "pedido-1");
    return Response.json({ mensagem: "Entre novamente" }, { status: 401 });
  };
  await assert.rejects(
    api("/mobile/v1/solicitacoes", {
      method: "POST",
      body: "{}",
      headers: { "Idempotency-Key": "pedido-1" },
    }),
    (erro) =>
      erro instanceof ErroApi &&
      erro.status === 401 &&
      erro.message === "Entre novamente",
  );
  assert.ok(expirou);
  await assert.rejects(api("https://outro.example/segredo"), /fora do gateway/);
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(
    await api("/mobile/v1/notificacoes/leitura-todas", { method: "POST" }),
    undefined,
  );
});
