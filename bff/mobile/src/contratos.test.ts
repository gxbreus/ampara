import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";
import { criarApp } from "./app.js";
import type { Config } from "./config.js";

const contrato = YAML.parse(
  readFileSync(
    new URL("../../../docs/contratos/bff-mobile.v1.yaml", import.meta.url),
    "utf8",
  ),
) as { components: unknown };
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
function validar(schema: string, corpo: unknown) {
  const verifica = ajv.compile({
    $ref: `#/components/schemas/${schema}`,
    components: contrato.components,
  });
  assert.ok(verifica(corpo), JSON.stringify(verifica.errors));
}
const ID = "6706e21b7a2d4b8e2194cf01";
const SOL = "c50a83ab-7db0-41b4-9436-4144c36f97d5";
const config: Config = {
  porta: 3020,
  timeoutMs: 100,
  jwtPublicKey: "",
  servicos: {
    animais: "http://animais",
    adocao: "http://adocao",
    identidade: "http://identidade",
    notificacoes: "http://notificacoes",
    assistente: "http://assistente",
  },
};
const animal = {
  id: ID,
  nome: "Thor",
  especie: "CAO",
  porte: "GRANDE",
  sexo: "MACHO",
  idadeMeses: 36,
  fotos: ["https://assets.ampara.dev/thor.webp"],
  fotoThumb: "https://assets.ampara.dev/thor-thumb.webp",
  bairro: "Centro",
  cidade: "Lavras",
  responsavel: { id: SOL, nome: "ONG Patas de Lavras", verificado: true },
  status: "DISPONIVEL",
  version: 1,
  atualizadoEm: "2026-11-17T12:00:00Z",
  distanciaKm: 2.4,
  descricao: null,
};
const solicitacao = {
  id: SOL,
  animalId: ID,
  adotanteId: "eu",
  estado: "AGUARDANDO_APROVACAO",
  criadoEm: "2026-11-17T12:00:00Z",
  expiraEm: null,
  motivo: null,
  desfecho: null,
  _links: {
    cancelar: { href: `/v1/solicitacoes/${SOL}/cancelamento`, method: "POST" },
  },
};

test("respostas reais do BFF seguem os schemas OpenAPI de busca e solicitações", async (t) => {
  const app = criarApp({
    config,
    logger: false,
    verificar: async () => ({ sub: "eu", role: "ADOTANTE" }),
    chamar: async (url) => {
      if (url.startsWith("http://animais/v1/animais/busca/"))
        return Response.json(animal);
      if (url.startsWith("http://animais/v1/animais/busca"))
        return Response.json({ itens: [animal], proximoCursor: null });
      if (url.startsWith("http://animais/v1/animais?")) {
        // Modelo de escrita (AnimalCompleto): sem fotoThumb/cidade, com endereco completo.
        const { id, nome, especie, porte, sexo, idadeMeses, fotos, status } = animal;
        const endereco = { rua: "Rua A", numero: "1", bairro: "Centro", cidade: "Lavras", uf: "MG", cep: "37200-000" };
        return Response.json({
          itens: [{ id, nome, especie, porte, sexo, idadeMeses, fotos, status, endereco }],
        });
      }
      if (url.startsWith("http://adocao/v1/solicitacoes?"))
        return Response.json({
          _embedded: { solicitacoes: [solicitacao] },
          _links: {},
        });
      if (url.endsWith("/historico"))
        return Response.json({
          itens: [{ para: "AGUARDANDO_APROVACAO", em: "2026-11-17T12:00:00Z" }],
        });
      return Response.json(solicitacao);
    },
  });
  t.after(() => app.close());
  const semToken = await app.inject("/mobile/v1/solicitacoes");
  assert.equal(semToken.statusCode, 401);
  assert.match(String(semToken.headers["content-type"]), /^application\/json/);
  validar("Problema", semToken.json());
  for (const [url, schema] of [
    ["/mobile/v1/animais", "PaginaBuscaMobile"],
    [`/mobile/v1/animais/${ID}`, "AnimalDetalheMobile"],
    ["/mobile/v1/solicitacoes", "ListaSolicitacoesMobile"],
    [`/mobile/v1/solicitacoes/${SOL}`, "SolicitacaoDetalheMobile"],
    [`/mobile/v1/solicitacoes/${SOL}/linha-do-tempo`, "LinhaDoTempoMobile"],
  ]) {
    const resposta = await app.inject({
      url,
      headers: { authorization: "Bearer valido" },
    });
    assert.equal(resposta.statusCode, 200, resposta.body);
    validar(schema, resposta.json());
  }
});
