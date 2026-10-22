import type { FastifyInstance, FastifyRequest } from "fastify";
import { exigirRoles, type Verificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { problema } from "./problema.js";
import { complementar, essencial, type Aviso } from "./servicos.js";
import { traduzirLinks, type ContaComPerfil, type PaginaAdocao, type SolicitacaoAdocao } from "./solicitacoes.js";

// Rotas de animais do painel (#61). Animais é o serviço essencial; a Adoção (solicitações
// ativas por animal) e a Identidade (dados do adotante) são complementares.

// --- formatos que chegam de Animais (docs/contratos/animais.v1.yaml)

export interface AnimalDeAnimais {
  id: string;
  responsavelId: string;
  nome: string;
  especie: string;
  porte: string;
  sexo: string;
  idadeMeses: number;
  temperamento: string[];
  descricao: string | null;
  fotos: string[];
  status: string;
  localizacao: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
  endereco: Endereco;
  historicoStatus: { status: string; motivo: string | null; alteradoEm: string; alteradoPor: string }[];
  atualizadoEm: string;
}

export interface PaginaAnimais {
  itens: AnimalDeAnimais[];
  proximoCursor?: string | null; // Animais omite na última página
}

interface Endereco {
  rua: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

interface ResumoAdocao {
  porEstado: Record<string, number>;
  ativasPorAnimal: Record<string, number>;
  concluidasNoMes: number;
}

// --- o que o painel envia (docs/contratos/bff-web.v1.yaml, AnimalEntrada)

interface AnimalEntrada {
  nome: string;
  especie: string;
  porte: string;
  sexo: string;
  idadeMeses: number;
  temperamento?: string[];
  descricao?: string | null;
  fotos: string[];
  localizacao: { lat: number; lng: number };
  endereco: Endereco;
}

// --- tradução

export const fotoCapa = (a: Pick<AnimalDeAnimais, "fotos">) => a.fotos[0] ?? null;

// Mudança manual grava o UUID de quem alterou (o responsável ou um ADMIN); a SAGA grava
// outra coisa (#57). Por isso, UUID é uma pessoa e o resto é a SAGA.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const origem = (alteradoPor: string) => (uuid.test(alteradoPor) ? "RESPONSAVEL" : "SAGA");

export function resumo(a: AnimalDeAnimais, solicitacoesAtivas: number | null) {
  return {
    id: a.id,
    nome: a.nome,
    especie: a.especie,
    porte: a.porte,
    status: a.status,
    fotoCapa: fotoCapa(a),
    solicitacoesAtivas,
    atualizadoEm: a.atualizadoEm,
  };
}

function endereco({ rua, numero, complemento, bairro, cidade, uf, cep }: Endereco) {
  return { rua, numero, complemento: complemento ?? null, bairro, cidade, uf, cep };
}

// O painel recebe a coordenada como { lat, lng } e Animais guarda GeoJSON ([lng, lat]).
// Sem descrição, o campo nem vai: Animais só aceita texto nele.
function paraAnimais(e: AnimalEntrada) {
  return {
    nome: e.nome,
    especie: e.especie,
    porte: e.porte,
    sexo: e.sexo,
    idadeMeses: e.idadeMeses,
    temperamento: e.temperamento ?? [],
    ...(e.descricao ? { descricao: e.descricao } : {}),
    fotos: e.fotos,
    localizacao: { type: "Point", coordinates: [e.localizacao.lng, e.localizacao.lat] },
    endereco: e.endereco,
  };
}

// No detalhe do animal, o link `animal` de cada solicitação apontaria para a própria página.
function semLinkDoAnimal(links: ReturnType<typeof traduzirLinks>) {
  return Object.fromEntries(Object.entries(links).filter(([nome]) => nome !== "animal"));
}

const ativos = new Set(["SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA", "COMPENSANDO"]);

// Ativas primeiro; dentro de cada grupo, as mais recentes primeiro.
function ordenar(a: SolicitacaoAdocao, b: SolicitacaoAdocao) {
  const ativa = Number(ativos.has(b.estado)) - Number(ativos.has(a.estado));
  return ativa || b.criadoEm.localeCompare(a.criadoEm);
}

// --- schemas de entrada (o Fastify valida antes de chamar Animais)

const idAnimal = { type: "object", required: ["id"], properties: { id: { type: "string", pattern: "^[0-9a-f]{24}$" } } };
const statusAnimal = ["DISPONIVEL", "EM_TRATAMENTO", "INDISPONIVEL", "RESERVADO", "ADOTADO"];

const corpoAnimal = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "especie", "porte", "sexo", "idadeMeses", "fotos", "localizacao", "endereco"],
  properties: {
    nome: { type: "string", minLength: 1, maxLength: 100 },
    especie: { type: "string", enum: ["CAO", "GATO", "OUTRO"] },
    porte: { type: "string", enum: ["PEQUENO", "MEDIO", "GRANDE"] },
    sexo: { type: "string", enum: ["MACHO", "FEMEA"] },
    idadeMeses: { type: "integer", minimum: 0 },
    temperamento: { type: "array", items: { type: "string" } },
    descricao: { type: ["string", "null"], maxLength: 2000 },
    fotos: { type: "array", minItems: 1, items: { type: "string", format: "uri" } },
    localizacao: {
      type: "object",
      additionalProperties: false,
      required: ["lat", "lng"],
      properties: { lat: { type: "number", minimum: -90, maximum: 90 }, lng: { type: "number", minimum: -180, maximum: 180 } },
    },
    endereco: {
      type: "object",
      additionalProperties: false,
      required: ["rua", "numero", "bairro", "cidade", "uf", "cep"],
      properties: {
        rua: { type: "string", minLength: 1 },
        numero: { type: "string", minLength: 1 },
        complemento: { type: ["string", "null"] },
        bairro: { type: "string", minLength: 1 },
        cidade: { type: "string", minLength: 1 },
        uf: { type: "string", minLength: 2, maxLength: 2 },
        cep: { type: "string", pattern: "^\\d{5}-\\d{3}$" },
      },
    },
  },
};

interface Dependencias {
  config: Config;
  verificar: Verificador;
  chamar: Cliente;
}

export function rotasDeAnimais(r: FastifyInstance, { config, verificar, chamar }: Dependencias) {
  const doPainel = exigirRoles(verificar, ["PROTETOR", "ONG", "ADMIN"]);
  const animais = `${config.servicos.animais}/v1/animais`;
  const resumoAdocao = (req: FastifyRequest, avisos: Aviso[]) =>
    complementar<ResumoAdocao>(chamar, "adocao",
      `${config.servicos.adocao}/v1/solicitacoes/resumo?${new URLSearchParams({ responsavelId: req.usuario!.sub })}`, req, avisos);
  const escrever = (metodo: string, corpo: unknown) => ({
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  r.get<{ Querystring: { status?: string; cursor?: string } }>(
    "/animais",
    {
      onRequest: doPainel,
      schema: {
        querystring: {
          type: "object",
          properties: { status: { type: "string", enum: statusAnimal }, cursor: { type: "string" } },
        },
      },
    },
    async (req) => {
      const filtros = new URLSearchParams({ responsavelId: req.usuario!.sub });
      if (req.query.status) filtros.set("status", req.query.status);
      if (req.query.cursor) filtros.set("cursor", req.query.cursor);
      const avisos: Aviso[] = [];
      const [pagina, adocao] = await Promise.all([
        essencial<PaginaAnimais>(chamar, "animais", `${animais}?${filtros}`, req),
        resumoAdocao(req, avisos),
      ]);
      return {
        itens: pagina.itens.map((a) => resumo(a, adocao ? (adocao.ativasPorAnimal[a.id] ?? 0) : null)),
        proximoCursor: pagina.proximoCursor ?? null,
        avisos,
      };
    },
  );

  r.post<{ Body: AnimalEntrada }>(
    "/animais",
    { onRequest: doPainel, schema: { body: corpoAnimal } },
    async (req, reply) => {
      const a = await essencial<AnimalDeAnimais>(chamar, "animais", animais, req, escrever("POST", paraAnimais(req.body)));
      // animal novo ainda não tem solicitação
      return reply.code(201).header("Location", `/web/v1/animais/${a.id}`).send(resumo(a, 0));
    },
  );

  r.get<{ Params: { id: string } }>("/animais/:id", { onRequest: doPainel, schema: { params: idAnimal } }, async (req) => {
    const avisos: Aviso[] = [];
    const filtros = new URLSearchParams({ animalId: req.params.id, responsavelId: req.usuario!.sub, limite: "100" });
    // Animais e Adoção em paralelo; a Identidade depois, com os adotantes de todas as solicitações
    const [a, pagina] = await Promise.all([
      essencial<AnimalDeAnimais>(chamar, "animais", `${animais}/${req.params.id}`, req),
      complementar<PaginaAdocao>(chamar, "adocao", `${config.servicos.adocao}/v1/solicitacoes?${filtros}`, req, avisos),
    ]);
    const solicitacoes = [...(pagina?._embedded.solicitacoes ?? [])].sort(ordenar);
    const adotantes = [...new Set(solicitacoes.map((s) => s.adotanteId))];
    const contas = adotantes.length
      ? await complementar<ContaComPerfil[]>(chamar, "identidade",
          `${config.servicos.identidade}/v1/contas?${new URLSearchParams({ ids: adotantes.join(","), incluir: "perfil" })}`, req, avisos)
      : null;
    const porId = new Map((contas ?? []).map((c) => [c.id, c]));
    const [lng, lat] = a.localizacao.coordinates;
    return {
      id: a.id,
      nome: a.nome,
      especie: a.especie,
      porte: a.porte,
      sexo: a.sexo,
      idadeMeses: a.idadeMeses,
      temperamento: a.temperamento,
      descricao: a.descricao ?? null,
      fotos: a.fotos,
      fotoCapa: fotoCapa(a),
      localizacao: { lat, lng, bairro: a.endereco.bairro, cidade: a.endereco.cidade },
      endereco: endereco(a.endereco),
      status: a.status,
      historicoStatus: a.historicoStatus.map((h) => ({ status: h.status, em: h.alteradoEm, por: origem(h.alteradoPor) })),
      atualizadoEm: a.atualizadoEm,
      solicitacoes: solicitacoes.map((s) => {
        const c = porId.get(s.adotanteId);
        return {
          id: s.id,
          estado: s.estado,
          desfecho: s.desfecho,
          expiraEm: s.expiraEm,
          criadoEm: s.criadoEm,
          decisao: s.decisao ?? null,
          adotante: c ? { id: c.id, nome: c.nome, cidade: c.cidade, perfil: c.perfil ?? null } : null,
          _links: semLinkDoAnimal(traduzirLinks(s._links)),
        };
      }),
      avisos,
    };
  });

  // A edição não consulta a Adoção, então solicitacoesAtivas vem null, como no contrato.
  r.put<{ Params: { id: string }; Body: AnimalEntrada }>(
    "/animais/:id",
    { onRequest: doPainel, schema: { params: idAnimal, body: corpoAnimal } },
    async (req) => {
      const a = await essencial<AnimalDeAnimais>(chamar, "animais", `${animais}/${req.params.id}`, req,
        escrever("PUT", paraAnimais(req.body)));
      return resumo(a, null);
    },
  );

  // RESERVADO e ADOTADO só mudam pela SAGA; Animais responde 409 se o animal estiver reservado.
  r.patch<{ Params: { id: string }; Body: { status: string; motivo?: string } }>(
    "/animais/:id/status",
    {
      onRequest: doPainel,
      schema: {
        params: idAnimal,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["DISPONIVEL", "EM_TRATAMENTO", "INDISPONIVEL"] },
            motivo: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (req) => {
      const a = await essencial<AnimalDeAnimais>(chamar, "animais", `${animais}/${req.params.id}/status`, req,
        escrever("PATCH", req.body));
      return resumo(a, null);
    },
  );
}

// Contadores do painel: todas as páginas de animais do responsável, de 100 em 100. Para
// a escala de uma ONG (dezenas de animais), é uma chamada; o teto evita laço sem fim.
const maxPaginas = 20;

export function rotaDoPainel(r: FastifyInstance, { config, verificar, chamar }: Dependencias) {
  const doPainel = exigirRoles(verificar, ["PROTETOR", "ONG", "ADMIN"]);

  r.get("/painel", { onRequest: doPainel }, async (req, reply) => {
    const avisos: Aviso[] = [];
    const sub = req.usuario!.sub;

    async function contarAnimais() {
      const porStatus: Record<string, number> = {};
      let cursor: string | null = null;
      for (let i = 0; i < maxPaginas; i++) {
        const filtros = new URLSearchParams({ responsavelId: sub, limite: "100" });
        if (cursor) filtros.set("cursor", cursor);
        const pagina = await complementar<PaginaAnimais>(chamar, "animais",
          `${config.servicos.animais}/v1/animais?${filtros}`, req, avisos);
        if (!pagina) return null;
        for (const a of pagina.itens) porStatus[a.status] = (porStatus[a.status] ?? 0) + 1;
        cursor = pagina.proximoCursor ?? null;
        if (!cursor) break;
      }
      const total = Object.values(porStatus).reduce((soma, n) => soma + n, 0);
      return { total, porStatus };
    }

    const [contadores, adocao] = await Promise.all([
      contarAnimais(),
      complementar<ResumoAdocao>(chamar, "adocao",
        `${config.servicos.adocao}/v1/solicitacoes/resumo?${new URLSearchParams({ responsavelId: sub })}`, req, avisos),
    ]);
    if (!contadores && !adocao) {
      // as duas fontes do painel falharam: não há o que mostrar
      return problema(reply, 503, "servico-indisponivel", "Serviço indisponível", "Animais e Adoção não responderam.");
    }
    return reply.send({
      animais: contadores,
      solicitacoes: adocao
        ? {
            aguardandoAprovacao: adocao.porEstado.AGUARDANDO_APROVACAO ?? 0,
            porEstado: adocao.porEstado,
            concluidasNoMes: adocao.concluidasNoMes,
          }
        : null,
      avisos,
    });
  });
}
