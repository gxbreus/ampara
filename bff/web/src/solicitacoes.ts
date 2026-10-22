import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Verificador } from "./auth.js";
import { exigirRoles } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { complementar, essencial, type Aviso } from "./servicos.js";

// Rotas de solicitações do painel (#61). A Adoção é o serviço essencial; a Identidade
// (dados do adotante) e Animais (nome e foto do animal) são complementares.

const estados = [
  "SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA", "COMPENSANDO", "CONCLUIDA",
  "REJEITADA_INDISPONIVEL", "PERFIL_INVALIDO", "RECUSADA", "CANCELADA", "EXPIRADA", "FALHOU",
];

// --- formatos que chegam dos serviços (docs/contratos/adocao.v1.yaml e identidade.v1.yaml)

interface Link {
  href: string;
  method?: "POST";
}

interface SolicitacaoAdocao {
  id: string;
  estado: string;
  desfecho: string | null;
  motivo: string | null;
  animalId: string;
  animalNome: string | null;
  adotanteId: string;
  expiraEm: string | null;
  criadoEm: string;
  _links: Record<string, Link>;
}

interface PaginaAdocao {
  _embedded: { solicitacoes: SolicitacaoAdocao[] };
  _links: { next?: Link };
}

interface HistoricoAdocao {
  itens: { de: string | null; para: string; evento: string; em: string }[];
}

interface ContaComPerfil {
  id: string;
  nome: string;
  cidade: string;
  perfil: {
    tipoMoradia: string;
    temQuintal?: boolean;
    outrosAnimais?: boolean;
    horasForaDeCasa?: number;
    completo: boolean;
  } | null;
}

// TODO(#21): conferir com o contrato de Animais quando ele existir.
interface AnimalDeAnimais {
  id: string;
  nome: string;
  fotoCapa: string | null;
}

// --- tradução para o formato do painel (docs/contratos/bff-web.v1.yaml)

// Só os links que o painel usa. O `historico` sai porque o detalhe já traz a linha do
// tempo, e o `cancelar` é do adotante.
const linksDoPainel = ["self", "animal", "aprovar", "recusar"];

export function traduzirLinks(links: Record<string, Link>): Record<string, Link> {
  const traduzidos: Record<string, Link> = {};
  for (const nome of linksDoPainel) {
    const link = links[nome];
    if (!link) continue;
    traduzidos[nome] = {
      href: link.href.replace(/^\/v1\//, "/web/v1/"),
      ...(link.method ? { method: link.method } : {}),
    };
  }
  return traduzidos;
}

function proximoCursor(pagina: PaginaAdocao): string | null {
  const next = pagina._links.next?.href;
  return next ? new URL(next, "http://adocao").searchParams.get("cursor") : null;
}

// Sem Animais, o nome vem da cópia que a Adoção guardou na reserva; a foto fica null.
function animal(s: SolicitacaoAdocao, animais: Map<string, AnimalDeAnimais>) {
  const a = animais.get(s.animalId);
  if (a) return { id: a.id, nome: a.nome, fotoCapa: a.fotoCapa ?? null };
  return s.animalNome ? { id: s.animalId, nome: s.animalNome, fotoCapa: null } : null;
}

function adotante(s: SolicitacaoAdocao, contas: Map<string, ContaComPerfil>) {
  const c = contas.get(s.adotanteId);
  return c ? { id: c.id, nome: c.nome, cidade: c.cidade, perfil: c.perfil ?? null } : null;
}

function porId<T extends { id: string }>(lista: T[] | null): Map<string, T> {
  return new Map((lista ?? []).map((item) => [item.id, item]));
}

// Uma chamada por serviço para a página inteira (sem N+1).
async function complementos(chamar: Cliente, config: Config, req: FastifyRequest, solicitacoes: SolicitacaoAdocao[]) {
  const avisos: Aviso[] = [];
  const adotantes = [...new Set(solicitacoes.map((s) => s.adotanteId))];
  const animais = [...new Set(solicitacoes.map((s) => s.animalId))];
  const [contas, bichos] = await Promise.all([
    adotantes.length
      ? complementar<ContaComPerfil[]>(chamar, "identidade",
          `${config.servicos.identidade}/v1/contas?${new URLSearchParams({ ids: adotantes.join(","), incluir: "perfil" })}`, req, avisos)
      : null,
    animais.length
      ? complementar<AnimalDeAnimais[]>(chamar, "animais",
          `${config.servicos.animais}/v1/animais?${new URLSearchParams({ ids: animais.join(",") })}`, req, avisos)
      : null,
  ]);
  return { contas: porId(contas), animais: porId(bichos), avisos };
}

interface Dependencias {
  config: Config;
  verificar: Verificador;
  chamar: Cliente;
}

export function rotasDeSolicitacoes(r: FastifyInstance, { config, verificar, chamar }: Dependencias) {
  const doPainel = exigirRoles(verificar, ["PROTETOR", "ONG", "ADMIN"]);
  const adocao = `${config.servicos.adocao}/v1/solicitacoes`;
  const id = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } };

  r.get<{ Querystring: { estado?: string; cursor?: string } }>(
    "/solicitacoes",
    {
      onRequest: doPainel,
      schema: {
        querystring: {
          type: "object",
          properties: { estado: { type: "string", enum: estados }, cursor: { type: "string" } },
        },
      },
    },
    async (req) => {
      const filtros = new URLSearchParams({ responsavelId: req.usuario!.sub });
      if (req.query.estado) filtros.set("estado", req.query.estado);
      if (req.query.cursor) filtros.set("cursor", req.query.cursor);
      const pagina = await essencial<PaginaAdocao>(chamar, "adocao", `${adocao}?${filtros}`, req);
      const solicitacoes = pagina._embedded.solicitacoes;
      const { contas, animais, avisos } = await complementos(chamar, config, req, solicitacoes);
      return {
        itens: solicitacoes.map((s) => ({
          id: s.id,
          estado: s.estado,
          desfecho: s.desfecho,
          expiraEm: s.expiraEm,
          criadoEm: s.criadoEm,
          animal: animal(s, animais),
          adotante: adotante(s, contas),
          _links: traduzirLinks(s._links),
        })),
        proximoCursor: proximoCursor(pagina),
        avisos,
      };
    },
  );

  r.get<{ Params: { id: string } }>("/solicitacoes/:id", { onRequest: doPainel, schema: { params: id } }, async (req) => {
    const [s, historico] = await Promise.all([
      essencial<SolicitacaoAdocao>(chamar, "adocao", `${adocao}/${req.params.id}`, req),
      essencial<HistoricoAdocao>(chamar, "adocao", `${adocao}/${req.params.id}/historico`, req),
    ]);
    const { contas, animais, avisos } = await complementos(chamar, config, req, [s]);
    return {
      id: s.id,
      estado: s.estado,
      desfecho: s.desfecho,
      motivo: s.motivo,
      expiraEm: s.expiraEm,
      criadoEm: s.criadoEm,
      animal: animal(s, animais),
      adotante: adotante(s, contas),
      historico: historico.itens.map(({ de, para, evento, em }) => ({ de, para, evento, em })),
      _links: traduzirLinks(s._links),
      avisos,
    };
  });

  // As decisões só repassam para a Adoção e traduzem os links. Respondem 202 porque a
  // SAGA segue assíncrona; o painel acompanha pelo `self`.
  async function decidir(req: FastifyRequest, idSolicitacao: string, caminho: "aprovacao" | "recusa", corpo: object) {
    const s = await essencial<SolicitacaoAdocao>(chamar, "adocao", `${adocao}/${idSolicitacao}/${caminho}`, req, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    return { id: s.id, estado: s.estado, desfecho: s.desfecho, _links: traduzirLinks(s._links) };
  }

  r.post<{ Params: { id: string } }>(
    "/solicitacoes/:id/aprovacao",
    { onRequest: doPainel, schema: { params: id } },
    async (req, reply) => reply.code(202).send(await decidir(req, req.params.id, "aprovacao", {})),
  );

  r.post<{ Params: { id: string }; Body: { motivo?: string } | undefined }>(
    "/solicitacoes/:id/recusa",
    {
      onRequest: doPainel,
      // o corpo é opcional: sem ele, a validação recebe um objeto vazio
      preValidation: (req, _reply, done) => {
        req.body ??= {};
        done();
      },
      schema: {
        params: id,
        body: { type: "object", additionalProperties: false, properties: { motivo: { type: "string", maxLength: 500 } } },
      },
    },
    async (req, reply) => reply.code(202).send(await decidir(req, req.params.id, "recusa", req.body ?? {})),
  );
}
