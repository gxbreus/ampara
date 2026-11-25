// Uma função por rota do contrato do BFF Web. Cada uma decide entre a chamada real e a
// simulação pelo grupo dela. Para ligar uma rota ao backend, ponha o grupo em
// PADRAO_REAIS (ou em VITE_ROTAS_REAIS) e pronto: as telas não mudam.
import { claimsDoToken, criarRotas, ErroApi, http, simular } from "@c/api";
import * as m from "./mocks";
import type {
  AnimalEntrada,
  AnimalPainel,
  AnimalResumo,
  ContaResumo,
  EstadoSolicitacao,
  MinhaConta,
  NovaConta,
  Pagina,
  Painel,
  SolicitacaoAcao,
  SolicitacaoDetalhe,
  SolicitacaoPainel,
  StatusAnimal,
  TokenSessao,
} from "./tipos";

// Situação em 25/11 na develop:
// - auth: o Vite assina o token (apps/compartilhado/dev-auth.ts) até a Identidade ter login (#149);
// - solicitacoes: BFF Web + Adoção prontos;
// - painel e animais: no PR #147; eu e admin: dependem da Identidade (#149).
export type Grupo = "auth" | "eu" | "painel" | "animais" | "solicitacoes" | "admin";
const PADRAO_REAIS: Grupo[] = ["auth", "solicitacoes"];
export const rotas = criarRotas<Grupo>(PADRAO_REAIS);

const naoEncontrado = (o: string) => new ErroApi(404, "Não encontrado", `Não existe ${o} com este identificador.`);

// ---------- autenticação (/auth/v1) ----------

export async function entrar(email: string, senha: string): Promise<{ token: string; conta: MinhaConta }> {
  if (rotas.real("auth")) {
    const sessao = await http<TokenSessao>("/auth/v1/sessoes", { method: "POST", corpo: { email, senha }, publico: true });
    const claims = sessao.claims ?? claimsDoToken(sessao.accessToken);
    const conta: MinhaConta = sessao.conta ?? {
      id: claims!.sub,
      nome: email.split("@")[0],
      email,
      role: claims!.role,
      cidade: "",
      statusVerificacao: "VERIFICADA",
    };
    return { token: sessao.accessToken, conta };
  }
  const role = email.startsWith("admin") ? "ADMIN" : email.startsWith("protetor") ? "PROTETOR" : "ONG";
  const conta: MinhaConta = { id: "00000000-0000-4000-8000-0000000000a1", nome: role === "ADMIN" ? "Admin Ampara" : "ONG Patinhas de Lavras", email, role, cidade: "Lavras", statusVerificacao: "VERIFICADA" };
  return simular({ token: "simulado", conta });
}

export async function cadastrar(dados: NovaConta) {
  if (rotas.real("auth")) return http<MinhaConta>("/auth/v1/contas", { method: "POST", corpo: dados, publico: true });
  return simular<MinhaConta>({ id: crypto.randomUUID(), nome: dados.nome, email: dados.email, role: dados.tipo, cidade: dados.cidade, statusVerificacao: dados.tipo === "ADOTANTE" ? "VERIFICADA" : "PENDENTE_VERIFICACAO" });
}

export async function eu(contaGuardada: MinhaConta | null): Promise<MinhaConta> {
  if (rotas.real("eu")) return http<MinhaConta>("/web/v1/eu");
  if (!contaGuardada) throw new ErroApi(401, "Não autenticado", "Entre de novo.");
  return simular(contaGuardada, 120);
}

// ---------- painel ----------

export async function obterPainel(): Promise<Painel> {
  if (rotas.real("painel")) return http<Painel>("/web/v1/painel");
  return simular(m.painel);
}

// ---------- animais ----------

export async function listarAnimais(filtro: { status?: StatusAnimal; cursor?: string } = {}): Promise<Pagina<AnimalResumo>> {
  if (rotas.real("animais")) {
    const q = new URLSearchParams();
    if (filtro.status) q.set("status", filtro.status);
    if (filtro.cursor) q.set("cursor", filtro.cursor);
    return http(`/web/v1/animais?${q}`);
  }
  return simular(() => ({
    itens: m.animais
      .filter((a) => !filtro.status || a.status === filtro.status)
      .map((a) => ({
        id: a.id,
        nome: a.nome,
        especie: a.especie,
        porte: a.porte,
        status: a.status,
        fotoCapa: a.fotoCapa,
        solicitacoesAtivas: m.solicitacoes.filter((s) => s.animal?.id === a.id && ["SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA"].includes(s.estado)).length,
        atualizadoEm: a.atualizadoEm,
      })),
    proximoCursor: null,
    avisos: [],
  }));
}

export async function obterAnimal(id: string): Promise<AnimalPainel> {
  if (rotas.real("animais")) return http(`/web/v1/animais/${id}`);
  return simular(() => {
    const a = m.animais.find((x) => x.id === id);
    if (!a) throw naoEncontrado("animal");
    return { ...a, solicitacoes: m.solicitacoesDoAnimal(id) };
  });
}

export async function cadastrarAnimal(dados: AnimalEntrada): Promise<AnimalPainel> {
  if (rotas.real("animais")) return http("/web/v1/animais", { method: "POST", corpo: dados, headers: { "Idempotency-Key": crypto.randomUUID() } });
  return simular(() => m.novoAnimal(dados));
}

export async function editarAnimal(id: string, dados: AnimalEntrada): Promise<AnimalPainel> {
  if (rotas.real("animais")) return http(`/web/v1/animais/${id}`, { method: "PUT", corpo: dados });
  return simular(() => {
    const a = m.animais.find((x) => x.id === id);
    if (!a) throw naoEncontrado("animal");
    Object.assign(a, dados, { fotoCapa: dados.fotos[0] ?? null, atualizadoEm: new Date().toISOString() });
    return { ...a, solicitacoes: m.solicitacoesDoAnimal(id) };
  });
}

export async function alterarStatus(id: string, status: "DISPONIVEL" | "EM_TRATAMENTO" | "INDISPONIVEL"): Promise<AnimalPainel> {
  if (rotas.real("animais")) return http(`/web/v1/animais/${id}/status`, { method: "PATCH", corpo: { status } });
  return simular(() => {
    const a = m.animais.find((x) => x.id === id);
    if (!a) throw naoEncontrado("animal");
    if (a.status === "RESERVADO" || a.status === "ADOTADO") {
      throw new ErroApi(409, "Status controlado pela SAGA", "O animal está reservado por uma solicitação em andamento.");
    }
    a.status = status;
    a.historicoStatus.push({ status, em: new Date().toISOString(), por: "RESPONSAVEL" });
    a.atualizadoEm = new Date().toISOString();
    return { ...a, solicitacoes: m.solicitacoesDoAnimal(id) };
  });
}

// ---------- solicitações ----------

export async function listarSolicitacoes(filtro: { estado?: EstadoSolicitacao; cursor?: string } = {}): Promise<Pagina<SolicitacaoPainel>> {
  if (rotas.real("solicitacoes")) {
    const q = new URLSearchParams();
    if (filtro.estado) q.set("estado", filtro.estado);
    if (filtro.cursor) q.set("cursor", filtro.cursor);
    return http(`/web/v1/solicitacoes?${q}`);
  }
  return simular(() => ({
    itens: m.solicitacoes
      .filter((s) => !filtro.estado || s.estado === filtro.estado)
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
      .map((s) => {
        const { id, estado, desfecho, expiraEm, criadoEm, animal, adotante, _links } = m.comLinks(s);
        return { id, estado, desfecho, expiraEm, criadoEm, animal, adotante, _links };
      }),
    proximoCursor: null,
    avisos: [],
  }));
}

export async function obterSolicitacao(id: string): Promise<SolicitacaoDetalhe> {
  if (rotas.real("solicitacoes")) return http(`/web/v1/solicitacoes/${id}`);
  return simular(() => {
    const s = m.solicitacoes.find((x) => x.id === id);
    if (!s) throw naoEncontrado("solicitação");
    return m.comLinks(s);
  });
}

// As decisões seguem o link HATEOAS que veio na resposta, não uma URL montada no front.
export async function seguirLink(href: string, corpo?: { motivo?: string }): Promise<SolicitacaoAcao> {
  if (rotas.real("solicitacoes")) return http(href, { method: "POST", corpo: corpo ?? {} });
  return simular(() => {
    const [, id, acao] = href.match(/solicitacoes\/([^/]+)\/(aprovacao|recusa)/) ?? [];
    const s = m.decidir(id, acao === "aprovacao" ? "aprovar" : "recusar", corpo?.motivo);
    if (!s) throw naoEncontrado("solicitação");
    return { id: s.id, estado: s.estado, desfecho: s.desfecho, _links: s._links };
  });
}

// ---------- admin ----------

export async function listarContas(statusVerificacao: "PENDENTE_VERIFICACAO" | "VERIFICADA" = "PENDENTE_VERIFICACAO"): Promise<ContaResumo[]> {
  if (rotas.real("admin")) return http(`/web/v1/admin/contas?statusVerificacao=${statusVerificacao}`);
  return simular(() => m.contas.filter((c) => c.statusVerificacao === statusVerificacao));
}

export async function verificarConta(id: string): Promise<ContaResumo> {
  if (rotas.real("admin")) return http(`/web/v1/admin/contas/${id}/verificacao`, { method: "PUT", corpo: { status: "VERIFICADA" } });
  return simular(() => {
    const c = m.contas.find((x) => x.id === id);
    if (!c) throw naoEncontrado("conta");
    c.statusVerificacao = "VERIFICADA";
    return c;
  });
}
