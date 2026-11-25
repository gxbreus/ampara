// Tipos do contrato docs/contratos/bff-mobile.v1.yaml (e do /auth/v1 da Identidade).
export type Especie = "CAO" | "GATO" | "OUTRO";
export type Porte = "PEQUENO" | "MEDIO" | "GRANDE";
export type Sexo = "MACHO" | "FEMEA";

export interface MinhaSolicitacaoItem {
  id: string;
  estado: string;
}

export interface AnimalCard {
  id: string;
  nome: string;
  fotoThumb: string;
  porte: Porte;
  distanciaKm: number;
  cidade: string;
  minhaSolicitacao: MinhaSolicitacaoItem | null;
  atualizadoEm: string;
  especie?: Especie; // a busca real de hoje manda; o contrato v1 não exige
}

export interface PaginaBusca {
  itens: AnimalCard[];
  proximoCursor?: string | null;
  avisos?: string[];
}

export interface AnimalDetalhe {
  id: string;
  nome: string;
  especie: Especie;
  porte: Porte;
  sexo: Sexo;
  idadeMeses: number;
  temperamento?: string[];
  descricao?: string;
  fotos: string[];
  fotoThumb: string;
  bairro: string;
  cidade: string;
  responsavel: { id: string; nome: string; verificado: boolean };
  status: "DISPONIVEL" | "EM_TRATAMENTO" | "INDISPONIVEL" | "RESERVADO" | "ADOTADO";
  minhaSolicitacao: MinhaSolicitacaoItem | null;
  atualizadoEm: string;
  avisos?: string[];
}

export interface SolicitacaoCriada {
  id: string;
  estado: string;
  animalId: string;
  criadoEm: string;
}

export interface SolicitacaoResumo {
  id: string;
  estado: string;
  criadoEm: string;
  expiraEm?: string;
  animal: { id: string; nome?: string; fotoThumb?: string; porte?: Porte; cidade?: string };
}

export interface SolicitacaoDetalhe {
  id: string;
  estado: string;
  criadoEm: string;
  expiraEm?: string;
  animal: { id: string; nome?: string } & Partial<Omit<AnimalDetalhe, "id" | "nome">>;
  _links?: Record<string, { href: string; method?: string }>;
  podeCancelar?: boolean;
  avisos?: string[];
}

export interface LinhaDoTempo {
  solicitacaoId: string;
  etapas: { etapa: string; descricao: string; concluidaEm: string }[];
}

export interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criadoEm: string;
}

export interface MinhaConta {
  id: string;
  nome: string;
  email: string;
  role: "ADOTANTE";
  cidade: string;
}

export interface PerfilAdocao {
  tipoMoradia?: "CASA" | "APARTAMENTO" | "SITIO";
  temQuintal?: boolean;
  outrosAnimais?: boolean;
  horasForaDeCasa?: number;
  aceiteTermo?: boolean;
  completo: boolean;
}

export interface RespostaPergunta {
  resposta: string;
  fontes?: { titulo: string; paginaOuSecao: string }[];
  degradado: boolean;
}

export interface RespostaRecomendacao {
  animais: { animalId: string; nome: string; motivoRecomendacao: string; fotoThumb?: string }[];
  explicacao: string;
  degradado: boolean;
}

export interface FiltroBusca {
  lat: number;
  lng: number;
  raioKm: number;
  especie?: Especie;
  porte?: Porte;
  idadeMaxMeses?: number;
  cursor?: string;
}
