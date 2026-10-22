import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { exportSPKI, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { parse } from "yaml";
import { criarApp } from "./app.js";
import { criarVerificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";

// Testes das rotas da #61. Os serviços são falsos, com respostas tiradas dos contratos, e
// toda resposta 2xx do BFF é validada contra o schema de docs/contratos/bff-web.v1.yaml.

const config: Config = {
  porta: 3010,
  timeoutMs: 3000,
  jwtPublicKey: "",
  servicos: { identidade: "http://identidade:3001", animais: "http://animais:8001", adocao: "http://adocao:8080" },
};

// --- contrato

const contrato = parse(readFileSync(new URL("../../../docs/contratos/bff-web.v1.yaml", import.meta.url), "utf8")) as object;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(contrato, "bff");

function seguirContrato(schema: string, corpo: unknown) {
  const validar = ajv.getSchema(`bff#/components/schemas/${schema}`);
  assert.ok(validar, `schema ${schema} não existe no contrato`);
  assert.ok(validar(corpo), `${schema}: ${ajv.errorsText(validar.errors)}`);
}

// --- JWT

const responsavel = "c50a83ab-7db0-41b4-9436-4144c36f97d5";
let privada: KeyLike;
let publicaPem: string;

before(async () => {
  const par = await generateKeyPair("RS256");
  privada = par.privateKey;
  publicaPem = await exportSPKI(par.publicKey);
});

async function auth(role = "ONG") {
  const t = await new SignJWT({ role })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(responsavel)
    .setIssuer("ampara-identidade")
    .setExpirationTime("1h")
    .sign(privada);
  return { authorization: `Bearer ${t}` };
}

// --- serviços falsos

type Resposta = { status?: number; corpo?: unknown; tipo?: string } | Error;

interface Chamada {
  metodo: string;
  url: string;
  cabecalhos: Headers;
  corpo: unknown;
}

// Responde conforme o mapa "MÉTODO url" (ou só a url, para GET); o que não estiver no mapa dá 404.
function servicos(respostas: Record<string, Resposta>) {
  const chamadas: Chamada[] = [];
  const chamar: Cliente = async (url, req, init = {}) => {
    const metodo = init.method ?? "GET";
    const cabecalhos = new Headers(init.headers);
    cabecalhos.set("X-Correlation-Id", req.id);
    if (req.headers.authorization) cabecalhos.set("Authorization", req.headers.authorization);
    chamadas.push({ metodo, url, cabecalhos, corpo: init.body ? JSON.parse(init.body as string) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? respostas[url] ?? { status: 404, corpo: { title: "não encontrado" } };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo ?? {}), {
      status: r.status ?? 200,
      headers: { "content-type": r.tipo ?? "application/json" },
    });
  };
  return { chamar, chamadas };
}

async function app(respostas: Record<string, Resposta>) {
  const falsos = servicos(respostas);
  const instancia = criarApp({ config, verificar: await criarVerificador(publicaPem), chamar: falsos.chamar, logger: false });
  return { instancia, chamadas: falsos.chamadas };
}

const timeout = () => new DOMException("tempo esgotado", "TimeoutError");

// --- dados (os exemplos dos contratos)

const idSolicitacao = "7f1c2a9e-4b3d-4e8a-9c61-2d5f8e0b3a17";
const idAdotante = "5aa91cf0-3811-4fe5-bb4f-4fdbef3e1d55";
const idAnimal = "65a2f1c4e8b9d3a7f0c1b2e9";
const base = `/v1/solicitacoes/${idSolicitacao}`;

const solicitacao = {
  id: idSolicitacao,
  estado: "AGUARDANDO_APROVACAO",
  desfecho: null,
  motivo: null,
  animalId: idAnimal,
  animalNome: "Thor",
  adotanteId: idAdotante,
  responsavelId: responsavel,
  expiraEm: "2026-11-20T15:00:00Z",
  criadoEm: "2026-11-17T15:00:00Z",
  atualizadoEm: "2026-11-17T15:00:02Z",
  requerIntervencao: false,
  _links: {
    self: { href: base },
    animal: { href: `/v1/animais/${idAnimal}` },
    historico: { href: `${base}/historico` },
    aprovar: { href: `${base}/aprovacao`, method: "POST" },
    recusar: { href: `${base}/recusa`, method: "POST" },
  },
};

const pagina = {
  _embedded: { solicitacoes: [solicitacao] },
  _links: {
    self: { href: `/v1/solicitacoes?responsavelId=${responsavel}` },
    next: { href: `/v1/solicitacoes?responsavelId=${responsavel}&cursor=abc123` },
  },
};

const contaComPerfil = {
  id: idAdotante,
  nome: "Bruna Silva",
  role: "ADOTANTE",
  cidade: "Lavras",
  statusVerificacao: "VERIFICADA",
  perfil: { tipoMoradia: "CASA", temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4, completo: true },
};

const animalCompleto = { id: idAnimal, nome: "Thor", fotoCapa: "https://exemplo.ampara.dev/fotos/thor-1.jpg", status: "RESERVADO" };

const historico = {
  itens: [
    { de: null, para: "SOLICITADA", evento: "SolicitacaoCriada", passo: null, em: "2026-11-17T15:00:00Z" },
    { de: "SOLICITADA", para: "ANIMAL_RESERVADO", evento: "AnimalReservado", passo: "T1", em: "2026-11-17T15:00:01Z" },
  ],
  _links: { self: { href: `${base}/historico` }, solicitacao: { href: base } },
};

const urls = {
  lista: `http://adocao:8080/v1/solicitacoes?responsavelId=${responsavel}`,
  detalhe: `http://adocao:8080${base}`,
  historico: `http://adocao:8080${base}/historico`,
  contas: `http://identidade:3001/v1/contas?ids=${idAdotante}&incluir=perfil`,
  animais: `http://animais:8001/v1/animais?ids=${idAnimal}`,
};

const linksTraduzidos = {
  self: { href: `/web/v1/solicitacoes/${idSolicitacao}` },
  animal: { href: `/web/v1/animais/${idAnimal}` },
  aprovar: { href: `/web/v1/solicitacoes/${idSolicitacao}/aprovacao`, method: "POST" },
  recusar: { href: `/web/v1/solicitacoes/${idSolicitacao}/recusa`, method: "POST" },
};

// --- GET /web/v1/solicitacoes

describe("GET /web/v1/solicitacoes", () => {
  it("agrega adotante e animal com uma chamada por serviço e traduz os links", async () => {
    const { instancia, chamadas } = await app({
      [urls.lista]: { corpo: pagina, tipo: "application/hal+json" },
      [urls.contas]: { corpo: [contaComPerfil] },
      [urls.animais]: { corpo: [animalCompleto] },
    });
    const r = await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth() });

    assert.equal(r.statusCode, 200);
    const corpo = r.json<{ itens: Record<string, unknown>[]; proximoCursor: string; avisos: unknown[] }>();
    seguirContrato("PaginaSolicitacoes", corpo);
    assert.deepEqual(corpo.itens[0].animal, { id: idAnimal, nome: "Thor", fotoCapa: animalCompleto.fotoCapa });
    assert.deepEqual(corpo.itens[0].adotante, { id: idAdotante, nome: "Bruna Silva", cidade: "Lavras", perfil: contaComPerfil.perfil });
    assert.deepEqual(corpo.itens[0]._links, linksTraduzidos);
    assert.equal(corpo.proximoCursor, "abc123");
    assert.deepEqual(corpo.avisos, []);
    assert.deepEqual(chamadas.map((c) => c.url).sort(), [urls.animais, urls.contas, urls.lista].sort());
  });

  it("repassa o Authorization e o X-Correlation-Id a todos os serviços", async () => {
    const { instancia, chamadas } = await app({ [urls.lista]: { corpo: pagina } });
    const cabecalhos = { ...(await auth()), "x-correlation-id": "c-61" };
    await instancia.inject({ url: "/web/v1/solicitacoes", headers: cabecalhos });
    for (const c of chamadas) {
      assert.equal(c.cabecalhos.get("Authorization"), cabecalhos.authorization);
      assert.equal(c.cabecalhos.get("X-Correlation-Id"), "c-61");
    }
  });

  it("repassa estado e cursor para a Adoção", async () => {
    const lista = `${urls.lista}&estado=AGUARDANDO_APROVACAO&cursor=abc123`;
    const { instancia, chamadas } = await app({ [lista]: { corpo: { ...pagina, _links: { self: pagina._links.self } } } });
    const r = await instancia.inject({ url: "/web/v1/solicitacoes?estado=AGUARDANDO_APROVACAO&cursor=abc123", headers: await auth() });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas[0].url, lista);
    assert.equal(r.json<{ proximoCursor: unknown }>().proximoCursor, null);
  });

  it("sem Identidade e sem Animais, responde 200 com avisos e o nome do animal copiado pela Adoção", async () => {
    const { instancia } = await app({
      [urls.lista]: { corpo: pagina },
      [urls.contas]: timeout(),
      [urls.animais]: { status: 503 },
    });
    const r = await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth() });

    assert.equal(r.statusCode, 200);
    const corpo = r.json<{ itens: Record<string, unknown>[]; avisos: unknown[] }>();
    seguirContrato("PaginaSolicitacoes", corpo);
    assert.equal(corpo.itens[0].adotante, null);
    assert.deepEqual(corpo.itens[0].animal, { id: idAnimal, nome: "Thor", fotoCapa: null });
    assert.deepEqual(corpo.avisos, [
      { servico: "identidade", motivo: "TIMEOUT" },
      { servico: "animais", motivo: "INDISPONIVEL" },
    ]);
  });

  it("página vazia não chama Identidade nem Animais", async () => {
    const { instancia, chamadas } = await app({ [urls.lista]: { corpo: { _embedded: { solicitacoes: [] }, _links: pagina._links } } });
    const r = await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth() });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas.length, 1);
  });

  it("503 quando a Adoção, que é essencial, não responde", async () => {
    const { instancia } = await app({ [urls.lista]: new Error("ECONNREFUSED") });
    const r = await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth() });
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers["content-type"], "application/problem+json; charset=utf-8");
    assert.equal(r.json<{ detail: string }>().detail, "Adoção não respondeu.");
  });

  it("503 também quando a Adoção responde 5xx", async () => {
    const { instancia } = await app({ [urls.lista]: { status: 500 } });
    assert.equal((await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth() })).statusCode, 503);
  });

  it("422 com estado fora do enum, sem chamar a Adoção", async () => {
    const { instancia, chamadas } = await app({});
    const r = await instancia.inject({ url: "/web/v1/solicitacoes?estado=QUALQUER", headers: await auth() });
    assert.equal(r.statusCode, 422);
    assert.equal(r.json<{ type: string }>().type, "https://ampara.dev/problemas/validacao");
    assert.equal(chamadas.length, 0);
  });

  it("401 vem antes da validação: sem token, nem o estado inválido é avaliado", async () => {
    const { instancia } = await app({});
    assert.equal((await instancia.inject({ url: "/web/v1/solicitacoes?estado=QUALQUER" })).statusCode, 401);
  });

  it("403 para ADOTANTE", async () => {
    const { instancia } = await app({});
    assert.equal((await instancia.inject({ url: "/web/v1/solicitacoes", headers: await auth("ADOTANTE") })).statusCode, 403);
  });
});

// --- GET /web/v1/solicitacoes/{id}

describe("GET /web/v1/solicitacoes/{id}", () => {
  it("junta solicitação, linha do tempo, adotante e animal", async () => {
    const { instancia } = await app({
      [urls.detalhe]: { corpo: solicitacao },
      [urls.historico]: { corpo: historico },
      [urls.contas]: { corpo: [contaComPerfil] },
      [urls.animais]: { corpo: [animalCompleto] },
    });
    const r = await instancia.inject({ url: `/web/v1/solicitacoes/${idSolicitacao}`, headers: await auth() });

    assert.equal(r.statusCode, 200);
    const corpo = r.json<{ historico: unknown[]; _links: unknown; avisos: unknown[] }>();
    seguirContrato("SolicitacaoDetalhe", corpo);
    assert.deepEqual(corpo.historico[1], { de: "SOLICITADA", para: "ANIMAL_RESERVADO", evento: "AnimalReservado", em: "2026-11-17T15:00:01Z" });
    assert.deepEqual(corpo._links, linksTraduzidos);
    assert.deepEqual(corpo.avisos, []);
  });

  it("repassa o 404 da Adoção", async () => {
    const problema = { type: "https://ampara.dev/problemas/nao-encontrado", title: "Não encontrado", status: 404, detail: "x" };
    const { instancia } = await app({
      [urls.detalhe]: { status: 404, corpo: problema, tipo: "application/problem+json" },
      [urls.historico]: { status: 404, corpo: problema, tipo: "application/problem+json" },
    });
    const r = await instancia.inject({ url: `/web/v1/solicitacoes/${idSolicitacao}`, headers: await auth() });
    assert.equal(r.statusCode, 404);
    assert.match(String(r.headers["content-type"]), /^application\/problem\+json/);
    assert.deepEqual(r.json(), problema);
  });

  it("422 com id que não é UUID", async () => {
    const { instancia } = await app({});
    assert.equal((await instancia.inject({ url: "/web/v1/solicitacoes/abc", headers: await auth() })).statusCode, 422);
  });
});

// --- decisões

describe("aprovação e recusa", () => {
  const aprovada = {
    ...solicitacao,
    estado: "APROVADA",
    _links: { self: solicitacao._links.self, animal: solicitacao._links.animal, historico: solicitacao._links.historico },
  };

  it("aprovação repassa para a Adoção e responde 202 com os links traduzidos", async () => {
    const { instancia, chamadas } = await app({ [`POST ${urls.detalhe}/aprovacao`]: { status: 202, corpo: aprovada } });
    const cabecalhos = await auth();
    const r = await instancia.inject({ method: "POST", url: `/web/v1/solicitacoes/${idSolicitacao}/aprovacao`, headers: cabecalhos });

    assert.equal(r.statusCode, 202);
    seguirContrato("SolicitacaoAcao", r.json());
    assert.deepEqual(r.json(), {
      id: idSolicitacao,
      estado: "APROVADA",
      desfecho: null,
      _links: { self: linksTraduzidos.self, animal: linksTraduzidos.animal },
    });
    assert.equal(chamadas[0].metodo, "POST");
    assert.equal(chamadas[0].cabecalhos.get("Authorization"), cabecalhos.authorization);
  });

  it("recusa repassa o motivo", async () => {
    const compensando = { ...aprovada, estado: "COMPENSANDO", desfecho: "RECUSADA", motivo: "Sem tela nas janelas." };
    const { instancia, chamadas } = await app({ [`POST ${urls.detalhe}/recusa`]: { status: 202, corpo: compensando } });
    const r = await instancia.inject({
      method: "POST",
      url: `/web/v1/solicitacoes/${idSolicitacao}/recusa`,
      headers: await auth(),
      payload: { motivo: "Sem tela nas janelas." },
    });
    assert.equal(r.statusCode, 202);
    seguirContrato("SolicitacaoAcao", r.json());
    assert.deepEqual(chamadas[0].corpo, { motivo: "Sem tela nas janelas." });
  });

  it("recusa sem corpo também vale", async () => {
    const { instancia, chamadas } = await app({ [`POST ${urls.detalhe}/recusa`]: { status: 202, corpo: aprovada } });
    const r = await instancia.inject({ method: "POST", url: `/web/v1/solicitacoes/${idSolicitacao}/recusa`, headers: await auth() });
    assert.equal(r.statusCode, 202);
    assert.deepEqual(chamadas[0].corpo, {});
  });

  it("422 com motivo acima de 500 caracteres", async () => {
    const { instancia, chamadas } = await app({});
    const r = await instancia.inject({
      method: "POST",
      url: `/web/v1/solicitacoes/${idSolicitacao}/recusa`,
      headers: await auth(),
      payload: { motivo: "x".repeat(501) },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(chamadas.length, 0);
  });

  it("repassa o 409 quando o estado não permite a ação", async () => {
    const problema = { type: "https://ampara.dev/problemas/estado-nao-permite-acao", title: "Estado não permite a ação", status: 409, detail: "x" };
    const { instancia } = await app({ [`POST ${urls.detalhe}/aprovacao`]: { status: 409, corpo: problema, tipo: "application/problem+json" } });
    const r = await instancia.inject({ method: "POST", url: `/web/v1/solicitacoes/${idSolicitacao}/aprovacao`, headers: await auth() });
    assert.equal(r.statusCode, 409);
    assert.deepEqual(r.json(), problema);
  });
});

// --- administração

describe("verificação de contas (só ADMIN)", () => {
  const fila = "http://identidade:3001/v1/contas?statusVerificacao=PENDENTE_VERIFICACAO";
  const idOng = "1d7e4c3a-2b9f-4f61-8a0e-6c5b3d2a1f90";
  const ong = { id: idOng, nome: "Protetores de Ijaci", role: "ONG", cidade: "Ijaci", statusVerificacao: "PENDENTE_VERIFICACAO" };

  for (const role of ["PROTETOR", "ONG"]) {
    it(`403 para ${role}`, async () => {
      const { instancia, chamadas } = await app({});
      const r = await instancia.inject({ url: "/web/v1/admin/contas", headers: await auth(role) });
      assert.equal(r.statusCode, 403);
      assert.equal(r.json<{ detail: string }>().detail, "A verificação de contas é exclusiva de administradores.");
      assert.equal(chamadas.length, 0);
    });
  }

  it("lista a fila pendente por padrão e corta campos fora do contrato", async () => {
    const { instancia, chamadas } = await app({ [fila]: { corpo: [{ ...ong, email: "nao@deve.sair" }] } });
    const r = await instancia.inject({ url: "/web/v1/admin/contas", headers: await auth("ADMIN") });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas[0].url, fila);
    assert.deepEqual(r.json(), [ong]);
    for (const conta of r.json<unknown[]>()) seguirContrato("ContaResumo", conta);
  });

  it("repassa o filtro de role", async () => {
    const { instancia, chamadas } = await app({ [`${fila}&role=ONG`]: { corpo: [] } });
    const r = await instancia.inject({ url: "/web/v1/admin/contas?role=ONG", headers: await auth("ADMIN") });
    assert.equal(r.statusCode, 200);
    assert.equal(chamadas[0].url, `${fila}&role=ONG`);
  });

  it("verifica a conta pela Identidade", async () => {
    const verificar = `PUT http://identidade:3001/v1/contas/${idOng}/verificacao`;
    const { instancia, chamadas } = await app({ [verificar]: { corpo: { ...ong, statusVerificacao: "VERIFICADA" } } });
    const r = await instancia.inject({
      method: "PUT",
      url: `/web/v1/admin/contas/${idOng}/verificacao`,
      headers: await auth("ADMIN"),
      payload: { status: "VERIFICADA" },
    });
    assert.equal(r.statusCode, 200);
    seguirContrato("ContaResumo", r.json());
    assert.deepEqual(chamadas[0].corpo, { status: "VERIFICADA" });
  });

  it("422 com status diferente de VERIFICADA", async () => {
    const { instancia } = await app({});
    const r = await instancia.inject({
      method: "PUT",
      url: `/web/v1/admin/contas/${idOng}/verificacao`,
      headers: await auth("ADMIN"),
      payload: { status: "PENDENTE_VERIFICACAO" },
    });
    assert.equal(r.statusCode, 422);
  });

  it("503 quando a Identidade não responde", async () => {
    const { instancia } = await app({ [fila]: timeout() });
    const r = await instancia.inject({ url: "/web/v1/admin/contas", headers: await auth("ADMIN") });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json<{ detail: string }>().detail, "Identidade não respondeu.");
  });
});
