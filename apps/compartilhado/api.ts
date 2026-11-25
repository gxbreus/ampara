// Cliente HTTP dos dois apps. Fala só com o gateway, pelo mesmo origin (o proxy do Vite
// em dev e o nginx no container), então não depende de CORS.
//
// Cada grupo de rotas é "real" ou "simulado". O padrão de cada app fica em src/api/rotas.ts
// e pode ser trocado sem mexer em código:
//   VITE_ROTAS_REAIS=solicitacoes,busca   liga só esses grupos ao backend
//   VITE_ROTAS_REAIS=todas                liga tudo
//   VITE_ROTAS_REAIS=nenhuma              roda o front sozinho, sem backend

export class ErroApi extends Error {
  constructor(
    public status: number,
    public titulo: string,
    public detalhe: string,
    public tipo?: string,
  ) {
    super(detalhe || titulo);
  }
}

const CHAVE_TOKEN = "ampara.token";
const CHAVE_CONTA = "ampara.conta";

export const sessaoGuardada = {
  token: () => localStorage.getItem(CHAVE_TOKEN),
  conta: <T>() => {
    const bruto = localStorage.getItem(CHAVE_CONTA);
    return bruto ? (JSON.parse(bruto) as T) : null;
  },
  salvar: (token: string, conta: unknown) => {
    localStorage.setItem(CHAVE_TOKEN, token);
    localStorage.setItem(CHAVE_CONTA, JSON.stringify(conta));
  },
  limpar: () => {
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_CONTA);
  },
};

export function claimsDoToken(token: string): { sub: string; role: string; exp: number } | null {
  try {
    const corpo = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(corpo));
  } catch {
    return null;
  }
}

export function criarRotas<G extends string>(padraoReais: readonly G[]) {
  const env = (import.meta.env.VITE_ROTAS_REAIS as string | undefined)?.trim();
  const reais = new Set<string>(
    !env ? padraoReais : env === "todas" ? ["*"] : env === "nenhuma" ? [] : env.split(",").map((s) => s.trim()),
  );
  return {
    real: (grupo: G) => reais.has("*") || reais.has(grupo),
    origem: (grupo: G): "real" | "simulado" => (reais.has("*") || reais.has(grupo) ? "real" : "simulado"),
  };
}

interface Opcoes extends Omit<RequestInit, "body"> {
  corpo?: unknown;
  publico?: boolean;
}

// Evento disparado quando um token expirado chega numa rota protegida.
export const EVENTO_SESSAO_EXPIRADA = "ampara:sessao-expirada";

export async function http<T>(caminho: string, { corpo, publico, headers, ...resto }: Opcoes = {}): Promise<T> {
  const token = sessaoGuardada.token();
  const cabecalhos = new Headers(headers);
  if (corpo !== undefined) cabecalhos.set("Content-Type", "application/json");
  if (token) cabecalhos.set("Authorization", `Bearer ${token}`);

  let resposta: Response;
  try {
    resposta = await fetch(caminho, { ...resto, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  } catch {
    throw new ErroApi(0, "Sem conexão", "Não foi possível falar com o gateway. Ele está no ar em localhost:8000?");
  }

  if (resposta.status === 204) return undefined as T;
  const texto = await resposta.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }

  if (!resposta.ok) {
    const p = (dados ?? {}) as { title?: string; detail?: string; type?: string; message?: string; mensagem?: string };
    // 401 numa rota protegida com token guardado = sessão expirou. No login, é senha errada
    // e quem chamou mostra a mensagem.
    if (resposta.status === 401 && token && !publico) window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    throw new ErroApi(
      resposta.status,
      p.title ?? `Erro ${resposta.status}`,
      p.detail ?? p.message ?? p.mensagem ?? (typeof dados === "string" ? dados : "A operação falhou."),
      p.type,
    );
  }
  return dados as T;
}

// Latência simulada, para os estados de carregamento aparecerem como no backend real.
export function simular<T>(valor: T | (() => T), ms = 280 + Math.random() * 320): Promise<T> {
  return new Promise((ok, falha) =>
    setTimeout(() => {
      try {
        ok(typeof valor === "function" ? (valor as () => T)() : structuredClone(valor));
      } catch (e) {
        falha(e);
      }
    }, ms),
  );
}

export function novoUuid() {
  return crypto.randomUUID();
}

// ---------- vocabulário da SAGA, igual nos dois apps ----------

export type Tom = "ok" | "atencao" | "erro" | "info" | "neutro";

export const ESTADOS: Record<string, { rotulo: string; tom: Tom; final?: boolean }> = {
  SOLICITADA: { rotulo: "Solicitada", tom: "info" },
  ANIMAL_RESERVADO: { rotulo: "Animal reservado", tom: "info" },
  AGUARDANDO_APROVACAO: { rotulo: "Aguardando aprovação", tom: "atencao" },
  APROVADA: { rotulo: "Aprovada", tom: "ok" },
  COMPENSANDO: { rotulo: "Desfazendo reserva", tom: "atencao" },
  CONCLUIDA: { rotulo: "Adoção concluída", tom: "ok", final: true },
  REJEITADA_INDISPONIVEL: { rotulo: "Animal indisponível", tom: "erro", final: true },
  PERFIL_INVALIDO: { rotulo: "Perfil incompleto", tom: "erro", final: true },
  RECUSADA: { rotulo: "Recusada", tom: "erro", final: true },
  CANCELADA: { rotulo: "Cancelada", tom: "neutro", final: true },
  EXPIRADA: { rotulo: "Expirada", tom: "neutro", final: true },
  FALHOU: { rotulo: "Falhou", tom: "erro", final: true },
};

export const STATUS_ANIMAL: Record<string, { rotulo: string; tom: Tom }> = {
  DISPONIVEL: { rotulo: "Disponível", tom: "ok" },
  EM_TRATAMENTO: { rotulo: "Em tratamento", tom: "info" },
  INDISPONIVEL: { rotulo: "Indisponível", tom: "neutro" },
  RESERVADO: { rotulo: "Reservado", tom: "atencao" },
  ADOTADO: { rotulo: "Adotado", tom: "ok" },
};

export const ESPECIES: Record<string, string> = { CAO: "Cão", GATO: "Gato", OUTRO: "Outro" };
export const PORTES: Record<string, string> = { PEQUENO: "Pequeno", MEDIO: "Médio", GRANDE: "Grande" };
export const MORADIAS: Record<string, string> = { CASA: "Casa", APARTAMENTO: "Apartamento", SITIO: "Sítio" };

export function idade(meses: number) {
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

const fmtData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const dataHora = (iso?: string | null) => (iso ? fmtData.format(new Date(iso)) : "—");

export function relativo(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const futuro = s < 0;
  const a = Math.abs(s);
  const txt = a < 60 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return futuro ? `em ${txt}` : `há ${txt}`;
}
