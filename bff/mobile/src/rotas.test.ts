import { test } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "./app.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";

const config: Config = {
  porta: 3020,
  timeoutMs: 50,
  jwtPublicKey: "",
  servicos: {
    animais: "http://animais",
    adocao: "http://adocao",
    identidade: "http://identidade",
    notificacoes: "http://notificacoes",
    assistente: "http://assistente",
  },
};
const ID = "6706e21b7a2d4b8e2194cf01";
const SOL = "c50a83ab-7db0-41b4-9436-4144c36f97d5";
const headers = { authorization: "Bearer adotante" };
const animal = {
  id: ID,
  nome: "Thor",
  fotoThumb: "https://a.dev/t.webp",
  porte: "MEDIO",
  distanciaKm: 2.4,
  cidade: "Lavras",
  atualizadoEm: "2026-11-17T12:00:00Z",
  endereco: "PRIVADO",
  historicoStatus: ["privado"],
  responsavel: { id: SOL, nome: "Patas", verificado: true, email: "privado" },
};
function servidor(chamar: Cliente) {
  return criarApp({
    config,
    chamar,
    logger: false,
    verificar: async (token) => {
      if (token === "ong") return { sub: "ong", role: "ONG" };
      if (token !== "adotante") throw new Error("inválido");
      return { sub: "eu", role: "ADOTANTE" };
    },
  });
}
test("20 cards têm 8 campos, uma consulta de adoção e payload menor que 6 KB", async (t) => {
  let chamadas = 0;
  const app = servidor(async (url) => {
    if (url.startsWith("http://adocao")) {
      chamadas++;
      assert.equal(new URL(url).searchParams.get("adotanteId"), "eu");
      return Response.json({
        _embedded: {
          solicitacoes: [{ id: SOL, animalId: ID, estado: "ANIMAL_RESERVADO" }],
        },
      });
    }
    return Response.json({
      itens: Array.from({ length: 20 }, (_, i) => ({
        ...animal,
        id: i === 0 ? ID : String(i),
      })),
    });
  });
  t.after(() => app.close());
  const r = await app.inject({
    url: "/mobile/v1/animais?lat=0&lng=0",
    headers,
  });
  assert.equal(r.statusCode, 200);
  const body = r.json<{ itens: Record<string, unknown>[] }>();
  assert.equal(Object.keys(body.itens[0]).length, 8);
  assert.deepEqual(body.itens[0].minhaSolicitacao, {
    id: SOL,
    estado: "ANIMAL_RESERVADO",
  });
  assert.equal(chamadas, 1);
  assert.ok(
    Buffer.byteLength(r.body) < 6000,
    String(Buffer.byteLength(r.body)),
  );
  assert.ok(!r.body.includes("PRIVADO"));
});
test("busca anônima não chama Adoção", async (t) => {
  const app = servidor(async (url) => {
    assert.ok(!url.startsWith("http://adocao"));
    return Response.json({ itens: [animal] });
  });
  t.after(() => app.close());
  const r = await app.inject("/mobile/v1/animais");
  assert.equal(
    r.json<{ itens: { minhaSolicitacao: null }[] }>().itens[0].minhaSolicitacao,
    null,
  );
});
test("token vencido, malformado ou de outro role degrada rotas públicas para anônimo", async (t) => {
  const autorizacoes: (string | undefined)[] = [];
  const app = servidor(async (url, req) => {
    assert.ok(!url.startsWith("http://adocao"), "não consulta a Adoção");
    autorizacoes.push(req.headers.authorization);
    return Response.json(url.endsWith(ID) ? animal : { itens: [animal] });
  });
  t.after(() => app.close());
  for (const authorization of ["Bearer vencido", "Bearer ong", "Basic abc", "Bearer"]) {
    const busca = await app.inject({
      url: "/mobile/v1/animais?lat=0&lng=0",
      headers: { authorization },
    });
    assert.equal(busca.statusCode, 200, authorization);
    assert.equal(
      busca.json<{ itens: { minhaSolicitacao: null }[] }>().itens[0]
        .minhaSolicitacao,
      null,
    );
    const detalhe = await app.inject({
      url: `/mobile/v1/animais/${ID}`,
      headers: { authorization },
    });
    assert.equal(detalhe.statusCode, 200, authorization);
    assert.equal(detalhe.json<{ minhaSolicitacao: null }>().minhaSolicitacao, null);
  }
  // O token recusado não é repassado aos serviços.
  assert.ok(autorizacoes.every((a) => a === undefined));
  // Rotas privadas continuam exigindo token válido de adotante.
  assert.equal(
    (
      await app.inject({
        url: "/mobile/v1/solicitacoes",
        headers: { authorization: "Bearer vencido" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        url: "/mobile/v1/solicitacoes",
        headers: { authorization: "Bearer ong" },
      })
    ).statusCode,
    403,
  );
});
test("Adoção indisponível degrada a busca e detalhe filtra dados privados", async (t) => {
  const app = servidor(async (url) => {
    if (url.startsWith("http://adocao")) throw new Error("offline");
    return Response.json(url.endsWith(ID) ? animal : { itens: [animal] });
  });
  t.after(() => app.close());
  const r = await app.inject({ url: "/mobile/v1/animais", headers });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json<{ avisos: string[] }>().avisos.length, 1);
  const detalhe = await app.inject(`/mobile/v1/animais/${ID}`);
  assert.ok(!detalhe.body.includes("privado"));
  assert.ok(!detalhe.body.includes("endereco"));
});
test("criação preserva idempotência e traduz Location e links", async (t) => {
  const app = servidor(async (url, _req, init) => {
    assert.equal(url, "http://adocao/v1/solicitacoes");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "pedido-1");
    return Response.json(
      {
        id: SOL,
        animalId: ID,
        estado: "SOLICITADA",
        criadoEm: "agora",
        _links: {},
      },
      { status: 202 },
    );
  });
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/mobile/v1/solicitacoes",
    headers: { ...headers, "idempotency-key": "pedido-1" },
    payload: { animalId: ID },
  });
  assert.equal(r.statusCode, 202);
  assert.equal(r.headers.location, `/mobile/v1/solicitacoes/${SOL}`);
});
test("Idempotency-Key é opcional e, quando vem, segue o mínimo de 8 da Adoção", async (t) => {
  const chaves: (string | null)[] = [];
  const app = servidor(async (_url, _req, init) => {
    chaves.push(new Headers(init?.headers).get("Idempotency-Key"));
    return Response.json(
      { id: SOL, animalId: ID, estado: "SOLICITADA", criadoEm: "agora", _links: {} },
      { status: 202 },
    );
  });
  t.after(() => app.close());
  const semChave = await app.inject({
    method: "POST",
    url: "/mobile/v1/solicitacoes",
    headers,
    payload: { animalId: ID },
  });
  assert.equal(semChave.statusCode, 202, semChave.body);
  assert.deepEqual(chaves, [null], "sem chave do app, nada é repassado");
  const curta = await app.inject({
    method: "POST",
    url: "/mobile/v1/solicitacoes",
    headers: { ...headers, "idempotency-key": "curta" },
    payload: { animalId: ID },
  });
  assert.equal(curta.statusCode, 400);
  assert.equal(curta.json<{ codigo: string }>().codigo, "parametros-invalidos");
  assert.equal(chaves.length, 1, "chave inválida não chega à Adoção");
});
test("parâmetros inválidos saem como 400 parametros-invalidos", async (t) => {
  const app = servidor(async (url) => {
    if (url.startsWith("http://animais/v1/animais/busca?"))
      return Response.json({ detail: [] }, { status: 422 });
    return Response.json({}, { status: 500 });
  });
  t.after(() => app.close());
  for (const r of [
    await app.inject("/mobile/v1/animais/nao-e-objectid"),
    await app.inject("/mobile/v1/animais?lat=999"),
    await app.inject({ url: "/mobile/v1/solicitacoes/123", headers }),
    await app.inject({
      method: "POST",
      url: "/mobile/v1/solicitacoes",
      headers,
      payload: { animalId: "x" },
    }),
  ]) {
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json<{ codigo: string }>().codigo, "parametros-invalidos");
  }
});
test("lista força o adotante do JWT e hidrata animais em lote", async (t) => {
  let lotes = 0;
  const app = servidor(async (url) => {
    if (url.startsWith("http://adocao")) {
      assert.equal(new URL(url).searchParams.get("adotanteId"), "eu");
      return Response.json({
        _embedded: { solicitacoes: [{ id: SOL, animalId: ID, _links: {} }] },
        _links: {},
      });
    }
    lotes++;
    assert.equal(new URL(url).searchParams.get("ids"), ID);
    // `GET /v1/animais?ids=` devolve o modelo de escrita (AnimalCompleto): fotos e endereco.
    return Response.json({
      itens: [
        {
          id: ID,
          nome: "Thor",
          porte: "MEDIO",
          fotos: ["https://a.dev/thor-1.webp", "https://a.dev/thor-2.webp"],
          endereco: { rua: "Rua Privada", numero: "10", bairro: "Centro", cidade: "Lavras", uf: "MG", cep: "37200-000" },
          localizacao: { type: "Point", coordinates: [-45, -21] },
          historicoStatus: ["privado"],
        },
      ],
    });
  });
  t.after(() => app.close());
  const r = await app.inject({
    url: "/mobile/v1/solicitacoes?adotanteId=outro",
    headers,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(lotes, 1);
  const item = r.json<{ itens: { animal: Record<string, unknown> }[] }>().itens[0];
  assert.deepEqual(item.animal, {
    id: ID,
    nome: "Thor",
    fotoThumb: "https://a.dev/thor-1.webp",
    porte: "MEDIO",
    cidade: "Lavras",
  });
  assert.ok(!r.body.includes("Rua Privada") && !r.body.includes("privado"));
});
test("lista usa a mesma miniatura e cidade da busca quando o Animais as entrega", async (t) => {
  const app = servidor(async (url) => {
    if (url.startsWith("http://adocao"))
      return Response.json({
        _embedded: { solicitacoes: [{ id: SOL, animalId: ID, _links: {} }] },
        _links: {},
      });
    return Response.json({
      itens: [{ ...animal, fotos: ["https://a.dev/grande.webp"] }],
    });
  });
  t.after(() => app.close());
  const r = await app.inject({ url: "/mobile/v1/solicitacoes", headers });
  const item = r.json<{ itens: { animal: Record<string, unknown> }[] }>().itens[0];
  assert.equal(item.animal.fotoThumb, animal.fotoThumb);
  assert.equal(item.animal.cidade, "Lavras");
});
test("solicitação alheia não expõe histórico nem permite cancelar", async (t) => {
  const app = servidor(async (url) => {
    assert.ok(!url.endsWith("historico") && !url.endsWith("cancelamento"));
    return Response.json({ adotanteId: "outro" });
  });
  t.after(() => app.close());
  for (const [method, suffix] of [
    ["GET", ""],
    ["GET", "/linha-do-tempo"],
    ["POST", "/cancelamento"],
  ] as const) {
    assert.equal(
      (
        await app.inject({
          method,
          url: `/mobile/v1/solicitacoes/${SOL}${suffix}`,
          headers,
        })
      ).statusCode,
      403,
    );
  }
});
test("cancelar depende do link mesmo em estado inesperado", async (t) => {
  let posts = 0;
  const app = servidor(async (_url, _req, init) => {
    if (init?.method === "POST") posts++;
    return Response.json({
      id: SOL,
      adotanteId: "eu",
      estado: "ESTADO_FUTURO",
      _links: { cancelar: { href: "/v1/x" } },
    });
  });
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/mobile/v1/solicitacoes/${SOL}/cancelamento`,
        headers,
      })
    ).statusCode,
    202,
  );
  assert.equal(posts, 1);
});
test("sem link cancelar recebe 409 sem POST upstream", async (t) => {
  const app = servidor(async (_url, _req, init) => {
    assert.ok(!init?.method);
    return Response.json({
      id: SOL,
      adotanteId: "eu",
      estado: "AGUARDANDO_APROVACAO",
      _links: {},
    });
  });
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/mobile/v1/solicitacoes/${SOL}/cancelamento`,
        headers,
      })
    ).statusCode,
    409,
  );
});
test("assistente offline devolve fallback e recebe prazo de 20 segundos", async (t) => {
  const app = servidor(async (_url, _req, init) => {
    assert.ok(init?.signal);
    throw new DOMException("offline", "TimeoutError");
  });
  t.after(() => app.close());
  for (const acao of ["perguntas", "recomendacoes"]) {
    const r = await app.inject({
      method: "POST",
      url: `/mobile/v1/assistente/${acao}`,
      headers,
      payload: { pergunta: "oi" },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json<{ degradado: boolean }>().degradado, true);
  }
});
