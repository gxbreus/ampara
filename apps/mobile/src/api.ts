export interface Link {
  href: string;
  method?: string;
}
export interface Card {
  id: string;
  nome: string;
  fotoThumb: string | null;
  porte: string;
  distanciaKm: number;
  cidade: string;
  atualizadoEm: string;
  minhaSolicitacao: { id: string; estado: string } | null;
}
export interface Animal extends Card {
  especie: string;
  sexo: string;
  idadeMeses: number;
  fotos: string[];
  descricao?: string;
  bairro: string;
  status: string;
  responsavel: { nome: string; verificado: boolean };
}
export interface Solicitacao {
  id: string;
  estado: string;
  motivo?: string;
  desfecho?: string;
  animal: { id: string; nome?: string; fotoThumb?: string };
  _links: Record<string, Link>;
}
export interface Perfil {
  tipoMoradia?: string;
  temQuintal?: boolean;
  outrosAnimais?: boolean;
  horasForaDeCasa?: number;
  aceiteTermo?: boolean;
  completo?: boolean;
  camposFaltando?: string[];
}
export interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criadoEm: string;
}
let token: string | null = null;
let expirada = () => {};
export function configurarSessao(valor: string | null, aoExpirar: () => void) {
  token = valor;
  expirada = aoExpirar;
}
export class ErroApi extends Error {
  constructor(
    public status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!/^\/(mobile\/v1|auth\/v1)\//.test(path))
    throw new Error("Rota fora do gateway");
  const base = process.env.EXPO_PUBLIC_API_URL;
  if (!base)
    throw new Error(
      "Configure EXPO_PUBLIC_API_URL com o IP da máquina que executa o gateway.",
    );
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), 25000);
  try {
    const response = await fetch(base.replace(/\/$/, "") + path, {
      ...init,
      headers,
      signal: controle.signal,
    });
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/auth/")) expirada();
      const erro = (await response.json().catch(() => ({}))) as {
        mensagem?: string;
        detail?: string;
      };
      throw new ErroApi(
        response.status,
        erro.mensagem ??
          erro.detail ??
          "Não foi possível concluir. Tente novamente.",
      );
    }
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;
    throw new Error(
      "Não foi possível conectar. Confira sua rede e o endereço do gateway.",
    );
  } finally {
    clearTimeout(prazo);
  }
}
export const finais = [
  "CONCLUIDA",
  "REJEITADA_INDISPONIVEL",
  "PERFIL_INVALIDO",
  "RECUSADA",
  "CANCELADA",
  "EXPIRADA",
  "FALHOU",
];
export const estados: Record<string, string> = {
  SOLICITADA: "Pedido recebido",
  ANIMAL_RESERVADO: "Animal reservado",
  AGUARDANDO_APROVACAO: "Aguardando resposta da ONG",
  APROVADA: "Adoção aprovada",
  COMPENSANDO: "Encerrando a solicitação…",
  CONCLUIDA: "Adoção concluída",
  PERFIL_INVALIDO: "Perfil incompleto",
  CANCELADA: "Cancelada",
  RECUSADA: "Recusada",
  EXPIRADA: "Prazo encerrado",
  FALHOU: "Solicitação encerrada",
  REJEITADA_INDISPONIVEL: "Animal indisponível",
};
