import type { FastifyInstance, FastifyRequest } from "fastify";
import { exigirRoles } from "./auth.js";
import type { Dependencias } from "./app.js";

interface Link {
  href: string;
  method?: string;
}
interface Solicitacao {
  id: string;
  animalId: string;
  animalNome?: string;
  adotanteId: string;
  estado: string;
  criadoEm: string;
  expiraEm?: string | null;
  motivo?: string | null;
  desfecho?: string | null;
  _links: Record<string, Link>;
}
interface Pagina {
  _embedded: { solicitacoes: Solicitacao[] };
  _links: { next?: Link };
}
interface Animal {
  id: string;
  nome: string;
  fotoThumb?: string | null;
  fotos?: string[];
  porte: string;
  // Projeção de busca traz `cidade`; o modelo de escrita (`GET /v1/animais?ids=`) traz `endereco.cidade`.
  cidade?: string;
  distanciaKm: number;
  atualizadoEm: string;
  especie: string;
  sexo: string;
  idadeMeses: number;
  temperamento?: string[];
  descricao?: string | null;
  bairro: string;
  status: string;
  responsavel: { id: string; nome: string; verificado: boolean };
  endereco?: { cidade?: string };
  historicoStatus?: unknown;
}
// Miniatura do cartão. A projeção de busca já entrega `fotoThumb`; o modelo de escrita
// (`AnimalCompleto`, devolvido por `GET /v1/animais?ids=`) só tem `fotos`. Nesse caso
// aplica a mesma regra que o Animais usa para montar `fotoThumb` na projeção
// (services/animais/app/repositorio/animais.py, montar_evento_outbox: a primeira foto).
function miniatura(a: Animal): string | null {
  return a.fotoThumb ?? a.fotos?.[0] ?? null;
}
// Cartão resumido do animal na lista de solicitações: mesmos campos do AnimalCard da
// busca que fazem sentido fora de uma busca geográfica (sem distância e sem minhaSolicitacao).
// Só copia campos conhecidos: o endereço completo do modelo de escrita nunca sai do BFF.
function resumo(id: string, a: Animal | undefined, nomeReserva?: string) {
  return {
    id,
    nome: a?.nome ?? nomeReserva,
    fotoThumb: a ? miniatura(a) : null,
    porte: a?.porte,
    cidade: a?.cidade ?? a?.endereco?.cidade,
  };
}
function ficha(a: Animal) {
  const {
    id,
    nome,
    especie,
    porte,
    sexo,
    idadeMeses,
    temperamento,
    descricao,
    fotos,
    fotoThumb,
    bairro,
    cidade,
    responsavel,
    status,
    atualizadoEm,
  } = a;
  return {
    id,
    nome,
    especie,
    porte,
    sexo,
    idadeMeses,
    temperamento,
    descricao,
    fotos,
    fotoThumb,
    bairro,
    cidade,
    responsavel: {
      id: responsavel.id,
      nome: responsavel.nome,
      verificado: responsavel.verificado,
    },
    status,
    atualizadoEm,
  };
}
export class ErroServico extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
export const frases: Record<string, string> = {
  SOLICITADA: "Solicitação recebida",
  ANIMAL_RESERVADO: "Animal reservado para você",
  AGUARDANDO_APROVACAO: "Aguardando resposta da ONG",
  APROVADA: "Adoção aprovada",
  COMPENSANDO: "Encerrando a solicitação…",
  CONCLUIDA: "Adoção concluída",
  PERFIL_INVALIDO: "Perfil incompleto",
  CANCELADA: "Solicitação cancelada",
  RECUSADA: "Solicitação recusada",
  EXPIRADA: "Prazo encerrado",
  FALHOU: "Solicitação encerrada",
  REJEITADA_INDISPONIVEL: "Animal indisponível",
};
const string = { type: "string" };
const card = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "nome",
    "fotoThumb",
    "porte",
    "distanciaKm",
    "cidade",
    "minhaSolicitacao",
    "atualizadoEm",
  ],
  properties: {
    id: string,
    nome: string,
    fotoThumb: { type: ["string", "null"] },
    porte: string,
    distanciaKm: { type: "number" },
    cidade: string,
    atualizadoEm: string,
    minhaSolicitacao: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "estado"],
          properties: { id: string, estado: string },
        },
      ],
    },
  },
};

export function rotas(
  app: FastifyInstance,
  { config, chamar, verificar }: Dependencias,
) {
  const privado = exigirRoles(
    verificar,
    ["ADOTANTE"],
    "Esta área é exclusiva de adotantes.",
  );
  // Rotas públicas (busca e detalhe): um token só enriquece a resposta. Token ausente,
  // malformado, vencido ou de outro role não bloqueia: a requisição segue como anônima,
  // sem consultar a Adoção e sem repassar o Authorization recusado aos serviços.
  const opcional = async (req: FastifyRequest) => {
    const [esquema, token] = (req.headers.authorization ?? "").split(" ");
    if (esquema === "Bearer" && token) {
      try {
        const usuario = await verificar(token);
        if (usuario.role === "ADOTANTE") {
          req.usuario = usuario;
          return;
        }
      } catch {
        // degrada para anônimo
      }
    }
    req.usuario = undefined;
    delete req.headers.authorization;
  };
  const adocao = config.servicos.adocao + "/v1/solicitacoes";
  async function json<T>(
    url: string,
    req: FastifyRequest,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await chamar(url, req, {
      ...init,
      signal:
        init.signal ??
        AbortSignal.timeout(init.method && init.method !== "GET" ? 5000 : 2000),
    });
    if (!response.ok) {
      const problema = (await response.json().catch(() => ({}))) as {
        detail?: string;
        type?: string;
      };
      throw new ErroServico(
        response.status >= 500 ? 503 : response.status,
        problema.type?.split("/").pop() ?? "servico-indisponivel",
        response.status >= 500
          ? "Serviço temporariamente indisponível."
          : (problema.detail ?? "Não foi possível concluir esta ação."),
      );
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  async function complementares(req: FastifyRequest, animalId?: string) {
    if (!req.usuario)
      return { itens: [] as Solicitacao[], avisos: [] as string[] };
    try {
      const qs = new URLSearchParams({
        adotanteId: req.usuario.sub,
        ativa: "true",
      });
      if (animalId) qs.set("animalId", animalId);
      const pagina = await json<Pagina>(`${adocao}?${qs}`, req);
      return { itens: pagina._embedded.solicitacoes, avisos: [] as string[] };
    } catch {
      return {
        itens: [] as Solicitacao[],
        avisos: ["Não foi possível consultar sua solicitação."],
      };
    }
  }
  function minha(lista: Solicitacao[], id: string) {
    const s = lista.find((s) => s.animalId === id);
    return s ? { id: s.id, estado: s.estado } : null;
  }
  function links(s: Solicitacao) {
    const base = `/mobile/v1/solicitacoes/${s.id}`;
    return {
      self: { href: base },
      historico: { href: `${base}/linha-do-tempo` },
      ...(s._links.cancelar
        ? { cancelar: { href: `${base}/cancelamento`, method: "POST" } }
        : {}),
    };
  }
  async function propria(req: FastifyRequest, id: string) {
    const s = await json<Solicitacao>(
      `${adocao}/${encodeURIComponent(id)}`,
      req,
    );
    if (s.adotanteId !== req.usuario?.sub)
      throw new ErroServico(
        403,
        "sem-permissao",
        "Esta solicitação pertence a outra pessoa.",
      );
    return s;
  }
  const idSchema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  };
  const animalIdSchema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", pattern: "^[0-9a-f]{24}$" } },
  };

  app.get(
    "/mobile/v1/animais",
    {
      onRequest: opcional,
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["itens"],
            properties: {
              itens: { type: "array", items: card },
              proximoCursor: { type: ["string", "null"] },
              avisos: { type: "array", items: string },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const query = req.url.includes("?")
        ? req.url.slice(req.url.indexOf("?"))
        : "";
      const [response, extras] = await Promise.all([
        chamar(`${config.servicos.animais}/v1/animais/busca${query}`, req, {
          signal: AbortSignal.timeout(2000),
        }),
        complementares(req),
      ]);
      reply.header(
        "X-Animais-Served-By",
        response.headers.get("x-served-by") ?? "desconhecido",
      );
      // O Animais valida os filtros (FastAPI responde 422); o contrato do BFF prevê 400.
      if (response.status === 400 || response.status === 422)
        throw new ErroServico(
          400,
          "parametros-invalidos",
          "Confira a localização e os filtros da busca.",
        );
      if (!response.ok)
        throw new ErroServico(
          response.status >= 500 ? 503 : response.status,
          "busca-indisponivel",
          "Não foi possível buscar animais. Confira a localização e tente novamente.",
        );
      const pagina = (await response.json()) as {
        itens: Animal[];
        proximoCursor?: string | null;
      };
      return {
        itens: pagina.itens.map((a) => ({
          ...a,
          fotoThumb: a.fotoThumb ?? null,
          minhaSolicitacao: minha(extras.itens, a.id),
        })),
        proximoCursor: pagina.proximoCursor ?? null,
        avisos: extras.avisos,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/mobile/v1/animais/:id",
    { onRequest: opcional, schema: { params: animalIdSchema } },
    async (req) => {
      const [animal, extras] = await Promise.all([
        json<Animal>(
          `${config.servicos.animais}/v1/animais/busca/${req.params.id}`,
          req,
        ),
        complementares(req, req.params.id),
      ]);
      // Lista explícita: dados privados novos no upstream também ficam fora da ficha.
      return {
        ...ficha(animal),
        minhaSolicitacao: minha(extras.itens, animal.id),
        avisos: extras.avisos,
      };
    },
  );
  app.post<{ Body: { animalId: string } }>(
    "/mobile/v1/solicitacoes",
    {
      onRequest: privado,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["animalId"],
          properties: {
            animalId: { type: "string", pattern: "^[0-9a-f]{24}$" },
          },
        },
        // Opcional, como no contrato. Quando vier, segue os limites da Adoção (8 a 128).
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (req, reply) => {
      // Sem chave, o BFF não inventa uma: um UUID novo a cada tentativa não deduplica nada.
      // A Adoção aceita o POST sem a chave e continua impedindo duas solicitações ativas
      // para o mesmo animal (409).
      const chave = req.headers["idempotency-key"];
      const s = await json<Solicitacao>(adocao, req, {
        method: "POST",
        body: JSON.stringify(req.body),
        headers: {
          "Content-Type": "application/json",
          ...(typeof chave === "string" ? { "Idempotency-Key": chave } : {}),
        },
      });
      return reply
        .code(202)
        .header("Location", `/mobile/v1/solicitacoes/${s.id}`)
        .send({
          id: s.id,
          animalId: s.animalId,
          estado: s.estado,
          criadoEm: s.criadoEm,
          _links: links(s),
        });
    },
  );
  app.get<{ Querystring: { cursor?: string } }>(
    "/mobile/v1/solicitacoes",
    { onRequest: privado },
    async (req) => {
      const qs = new URLSearchParams({ adotanteId: req.usuario!.sub });
      if (req.query.cursor) qs.set("cursor", req.query.cursor);
      const pagina = await json<Pagina>(`${adocao}?${qs}`, req);
      const lista = pagina._embedded.solicitacoes;
      let animais: Animal[] = [];
      const avisos: string[] = [];
      if (lista.length) {
        try {
          animais = (
            await json<{ itens: Animal[] }>(
              `${config.servicos.animais}/v1/animais?${new URLSearchParams({ ids: [...new Set(lista.map((s) => s.animalId))].join(",") })}`,
              req,
            )
          ).itens;
        } catch {
          avisos.push("As fotos dos animais estão indisponíveis.");
        }
      }
      return {
        itens: lista.map((s) => {
          const a = animais.find((a) => a.id === s.animalId);
          return {
            id: s.id,
            estado: s.estado,
            criadoEm: s.criadoEm,
            expiraEm: s.expiraEm,
            desfecho: s.desfecho,
            motivo: s.motivo,
            _links: links(s),
            animal: resumo(s.animalId, a, s.animalNome),
          };
        }),
        proximoCursor: pagina._links.next
          ? new URL(pagina._links.next.href, adocao).searchParams.get("cursor")
          : null,
        avisos,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/mobile/v1/solicitacoes/:id",
    { onRequest: privado, schema: { params: idSchema } },
    async (req) => {
      const s = await propria(req, req.params.id);
      let animal: ReturnType<typeof ficha> | { id: string; nome?: string } = {
        id: s.animalId,
        nome: s.animalNome,
      };
      const avisos: string[] = [];
      try {
        animal = ficha(
          await json<Animal>(
            `${config.servicos.animais}/v1/animais/busca/${s.animalId}`,
            req,
          ),
        );
      } catch {
        avisos.push("A ficha do animal está indisponível.");
      }
      // O read model já é público, mas a resposta continua usando só campos conhecidos.
      return {
        id: s.id,
        estado: s.estado,
        criadoEm: s.criadoEm,
        expiraEm: s.expiraEm,
        motivo: s.motivo,
        desfecho: s.desfecho,
        animal:
          "responsavel" in animal
            ? { ...animal, minhaSolicitacao: { id: s.id, estado: s.estado } }
            : animal,
        _links: links(s),
        avisos,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/mobile/v1/solicitacoes/:id/linha-do-tempo",
    { onRequest: privado, schema: { params: idSchema } },
    async (req) => {
      await propria(req, req.params.id);
      const historico = await json<{ itens: { para: string; em: string }[] }>(
        `${adocao}/${req.params.id}/historico`,
        req,
      );
      return {
        solicitacaoId: req.params.id,
        etapas: historico.itens.map((i) => ({
          etapa: i.para,
          descricao: frases[i.para] ?? i.para,
          concluidaEm: i.em,
        })),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/mobile/v1/solicitacoes/:id/cancelamento",
    { onRequest: privado, schema: { params: idSchema } },
    async (req, reply) => {
      const s = await propria(req, req.params.id);
      if (!s._links.cancelar)
        throw new ErroServico(
          409,
          "acao-indisponivel",
          "Esta solicitação não pode mais ser cancelada.",
        );
      const atualizada = await json<Solicitacao>(
        `${adocao}/${req.params.id}/cancelamento`,
        req,
        { method: "POST" },
      );
      return reply
        .code(202)
        .send({
          id: atualizada.id,
          estado: atualizada.estado,
          _links: links(atualizada),
        });
    },
  );
  for (const [externa, interna] of [
    ["eu", "contas/eu"],
    ["eu/perfil-adocao", "contas/eu/perfil-adocao"],
    ["notificacoes", "notificacoes"],
  ]) {
    const servico = externa === "notificacoes" ? "notificacoes" : "identidade";
    app.get(`/mobile/v1/${externa}`, { onRequest: privado }, async (req) => {
      const query = req.url.includes("?")
        ? req.url.slice(req.url.indexOf("?"))
        : "";
      return json<unknown>(
        `${config.servicos[servico]}/v1/${interna}${query}`,
        req,
      );
    });
  }
  app.put("/mobile/v1/eu/perfil-adocao", { onRequest: privado }, async (req) =>
    json<unknown>(
      `${config.servicos.identidade}/v1/contas/eu/perfil-adocao`,
      req,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      },
    ),
  );
  for (const rota of [
    "notificacoes/:id/leitura",
    "notificacoes/leitura-todas",
  ]) {
    app.post<{ Params: { id?: string } }>(
      `/mobile/v1/${rota}`,
      { onRequest: privado },
      async (req, reply) => {
        const caminho = rota.replace(
          ":id",
          encodeURIComponent(req.params.id ?? ""),
        );
        await json<unknown>(
          `${config.servicos.notificacoes}/v1/${caminho}`,
          req,
          { method: "POST" },
        );
        return reply.code(204).send();
      },
    );
  }
  for (const acao of ["perguntas", "recomendacoes"]) {
    app.post<{ Body: { pergunta?: string; descricaoRotina?: string; lat?: number; lng?: number; raioKm?: number } }>(
      `/mobile/v1/assistente/${acao}`,
      {
        onRequest: privado,
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: acao === "perguntas" ? ["pergunta"] : ["descricaoRotina", "lat", "lng"],
            properties: acao === "perguntas"
              ? { pergunta: { type: "string", minLength: 3, maxLength: 500 } }
              : {
                  descricaoRotina: { type: "string", minLength: 10, maxLength: 1000 },
                  lat: { type: "number", minimum: -90, maximum: 90 },
                  lng: { type: "number", minimum: -180, maximum: 180 },
                  raioKm: { type: "number", minimum: 1, maximum: 100 },
                },
          },
        },
      },
      async (req) => {
        try {
          const resposta = await json<{
            resposta: string;
            fontes: { titulo: string; origem: string }[];
            sugestoes: { animalId: string; nome: string; motivo: string; fotoThumb?: string }[];
            explicacao: string;
            degradado: boolean;
          }>(
            `${config.servicos.assistente}/v1/${acao}`,
            req,
            {
              method: "POST",
              body: JSON.stringify(acao === "perguntas" ? { pergunta: req.body.pergunta } : {
                rotina: req.body.descricaoRotina,
                lat: req.body.lat,
                lng: req.body.lng,
                raioKm: req.body.raioKm ?? 10,
              }),
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(20000),
            },
          );
          return acao === "perguntas" ? {
            resposta: resposta.resposta,
            fontes: resposta.fontes.map((f) => ({ titulo: f.titulo, paginaOuSecao: f.origem })),
            degradado: resposta.degradado,
          } : {
            animais: resposta.sugestoes.map((a) => ({
              animalId: a.animalId,
              nome: a.nome,
              motivoRecomendacao: a.motivo,
              ...(a.fotoThumb ? { fotoThumb: a.fotoThumb } : {}),
            })),
            explicacao: resposta.explicacao,
            degradado: resposta.degradado,
          };
        } catch (erro) {
          if (erro instanceof ErroServico && erro.status < 500) throw erro;
          const mensagem =
            "O assistente está indisponível. Você pode continuar buscando animais e acompanhando suas solicitações.";
          return acao === "perguntas"
            ? { resposta: mensagem, fontes: [], degradado: true }
            : { animais: [], explicacao: mensagem, degradado: true };
        }
      },
    );
  }
}
