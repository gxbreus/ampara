import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidatos, criarResolvedor, lerResolvConf } from "./dns.js";

const k8s = lerResolvConf(`search ampara.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10
options ndots:5`);
const compose = lerResolvConf(`nameserver 127.0.0.11
search ufla.br
options edns0 trust-ad ndots:0`);

describe("resolv.conf e candidatos", () => {
  it("lê search e ndots", () => {
    assert.deepEqual(k8s, { search: ["ampara.svc.cluster.local", "svc.cluster.local", "cluster.local"], ndots: 5 });
    assert.deepEqual(compose, { search: ["ufla.br"], ndots: 0 });
  });

  it("no Kubernetes, nome curto tenta os sufixos antes do nome puro", () => {
    assert.deepEqual(candidatos("adocao", k8s), [
      "adocao.ampara.svc.cluster.local",
      "adocao.svc.cluster.local",
      "adocao.cluster.local",
      "adocao",
    ]);
  });

  it("no Compose (ndots:0), o nome puro vem primeiro", () => {
    assert.deepEqual(candidatos("adocao", compose), ["adocao", "adocao.ufla.br"]);
  });

  it("nome terminado em ponto é absoluto", () => {
    assert.deepEqual(candidatos("adocao.ampara.svc.cluster.local.", k8s), ["adocao.ampara.svc.cluster.local"]);
  });
});

describe("resolvedor", () => {
  const tabela: Record<string, string[]> = { "adocao.ampara.svc.cluster.local": ["10.96.122.138"] };
  const falso = async (n: string) => {
    if (tabela[n]) return tabela[n];
    throw Object.assign(new Error("não existe"), { code: "ENOTFOUND" });
  };

  it("resolve nome curto pelo sufixo de busca", async () => {
    assert.deepEqual(await criarResolvedor(k8s, falso)("adocao"), ["10.96.122.138"]);
  });

  it("falha com o erro da última tentativa quando nenhum candidato existe", async () => {
    await assert.rejects(criarResolvedor(k8s, falso)("identidade"), { code: "ENOTFOUND" });
  });

  it("não consulta o DNS para um IP", async () => {
    assert.deepEqual(await criarResolvedor(k8s, async () => assert.fail("consultou o DNS"))("10.0.0.1"), ["10.0.0.1"]);
  });

  it("respeita a prioridade: o sufixo do cluster vence o nome puro mais rápido", async () => {
    const lento = async (n: string) => {
      if (n === "adocao") return ["1.1.1.1"];
      await new Promise((r) => setTimeout(r, 20));
      if (n === "adocao.ampara.svc.cluster.local") return ["10.96.122.138"];
      throw new Error("não existe");
    };
    assert.deepEqual(await criarResolvedor(k8s, lento)("adocao"), ["10.96.122.138"]);
  });
});
