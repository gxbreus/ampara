// Tipos do contrato docs/contratos/bff-web.v1.yaml (e do /auth/v1 da Identidade).

export type Role = "ADOTANTE" | "PROTETOR" | "ONG" | "ADMIN";
export type StatusAnimal = "DISPONIVEL" | "EM_TRATAMENTO" | "INDISPONIVEL" | "RESERVADO" | "ADOTADO";
export type Especie = "CAO" | "GATO" | "OUTRO";
export type Porte = "PEQUENO" | "MEDIO" | "GRANDE";
export type EstadoSolicitacao =
  | "SOLICITADA"
  | "ANIMAL_RESERVADO"
  | "AGUARDANDO_APROVACAO"
  | "APROVADA"
  | "COMPENSANDO"
  | "CONCLUIDA"
  | "REJEITADA_INDISPONIVEL"
  | "PERFIL_INVALIDO"
  | "RECUSADA"
  | "CANCELADA"
  | "EXPIRADA"
  | "FALHOU";

export interface Aviso {
  servico: "animais" | "adocao" | "identidade";
  motivo: "TIMEOUT" | "INDISPONIVEL" | "CIRCUITO_ABERTO";
}

export interface Link {
  href: string;
  method?: "POST";
}
export interface LinksSolicitacao {
  self: Link;
  animal?: Link;
  aprovar?: Link;
  recusar?: Link;
}

export interface PerfilResumo {
  tipoMoradia: "CASA" | "APARTAMENTO" | "SITIO";
  temQuintal?: boolean;
  outrosAnimais?: boolean;
  horasForaDeCasa?: number;
  completo: boolean;
}
export type Adotante = { id: string; nome: string; cidade: string; perfil: PerfilResumo | null } | null;
export type AnimalMini = { id: string; nome: string; fotoCapa: string | null } | null;

export interface Localizacao {
  lat: number;
  lng: number;
  bairro: string;
  cidade: string;
}

export interface AnimalEntrada {
  nome: string;
  especie: Especie;
  porte: Porte;
  idadeMeses: number;
  temperamento?: string[];
  fotos: string[];
  localizacao: Localizacao;
}

export interface AnimalResumo {
  id: string;
  nome: string;
  especie: Especie;
  porte: Porte;
  status: StatusAnimal;
  fotoCapa: string | null;
  solicitacoesAtivas: number | null;
  atualizadoEm: string;
}

export interface Pagina<T> {
  itens: T[];
  proximoCursor: string | null;
  avisos: Aviso[];
}

export interface SolicitacaoDoAnimal {
  id: string;
  estado: EstadoSolicitacao;
  desfecho: string | null;
  expiraEm: string | null;
  criadoEm: string;
  adotante: Adotante;
  _links: LinksSolicitacao;
}

export interface AnimalPainel extends AnimalEntrada {
  id: string;
  temperamento: string[];
  fotoCapa: string | null;
  status: StatusAnimal;
  historicoStatus: { status: StatusAnimal; em: string; por: "RESPONSAVEL" | "SAGA" }[];
  atualizadoEm: string;
  solicitacoes: SolicitacaoDoAnimal[];
  avisos: Aviso[];
}

export interface SolicitacaoPainel {
  id: string;
  estado: EstadoSolicitacao;
  desfecho: string | null;
  expiraEm: string | null;
  criadoEm: string;
  animal: AnimalMini;
  adotante: Adotante;
  _links: LinksSolicitacao;
}

export interface SolicitacaoDetalhe extends SolicitacaoPainel {
  motivo: string | null;
  historico: { de: EstadoSolicitacao | null; para: EstadoSolicitacao; evento: string; em: string }[];
  avisos: Aviso[];
}

export interface SolicitacaoAcao {
  id: string;
  estado: EstadoSolicitacao;
  desfecho: string | null;
  _links: LinksSolicitacao;
}

export interface Painel {
  animais: { total: number; porStatus: Partial<Record<StatusAnimal, number>> } | null;
  solicitacoes: { aguardandoAprovacao: number; porEstado: Partial<Record<EstadoSolicitacao, number>>; concluidasNoMes: number } | null;
  avisos: Aviso[];
}

export interface MinhaConta {
  id: string;
  nome: string;
  email: string;
  role: Role;
  cidade: string;
  statusVerificacao: "PENDENTE_VERIFICACAO" | "VERIFICADA";
}

export type ContaResumo = Omit<MinhaConta, "email">;

export interface TokenSessao {
  accessToken: string;
  tokenType: "Bearer";
  expiraEm: string;
  claims: { iss: string; sub: string; role: Role; exp: number };
  conta?: MinhaConta; // só o login de desenvolvimento manda
}

export interface NovaConta {
  nome: string;
  email: string;
  senha: string;
  cidade: string;
  tipo: "ADOTANTE" | "PROTETOR" | "ONG";
}
