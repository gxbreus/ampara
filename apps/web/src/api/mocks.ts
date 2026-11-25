// Dados simulados do painel, no formato do contrato do BFF Web. Ficam em memória e mudam
// com as ações (aprovar, recusar, cadastrar), para a tela se comportar como a real.
import { novoUuid } from "@c/api";
import { FOTOS_DEMO } from "@c/fotos-demo";
import type {
  AnimalEntrada,
  AnimalPainel,
  AnimalResumo,
  ContaResumo,
  EstadoSolicitacao,
  Painel,
  SolicitacaoDetalhe,
  StatusAnimal,
} from "./tipos";

const agora = Date.now();
const ha = (h: number) => new Date(agora - h * 3600_000).toISOString();
const daqui = (h: number) => new Date(agora + h * 3600_000).toISOString();
const oid = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

const lavras = (lat: number, lng: number, bairro = "Centro") => ({ lat, lng, bairro, cidade: "Lavras" });
// o mesmo endereço do seed (scripts/seed/seed_animais.py)
const ENDERECO = { rua: "Rua Doutor Francisco Sales", numero: "100", complemento: null, bairro: "Centro", cidade: "Lavras", uf: "MG", cep: "37200-000" };

const base: [string, AnimalPainel["especie"], AnimalPainel["porte"], number, string[], StatusAnimal, number, number][] = [
  ["Paçoca", "CAO", "MEDIO", 24, ["dócil", "brincalhona"], "RESERVADO", -21.2449, -45.0003],
  ["Thor", "CAO", "GRANDE", 48, ["protetor", "calmo"], "DISPONIVEL", -21.239, -44.996],
  ["Mel", "GATO", "PEQUENO", 8, ["curiosa"], "DISPONIVEL", -21.251, -45.005],
  ["Biscoito", "CAO", "PEQUENO", 6, ["filhote", "agitado"], "EM_TRATAMENTO", -21.23, -44.99],
  ["Luna", "GATO", "PEQUENO", 36, ["independente"], "ADOTADO", -21.247, -44.985],
  ["Bolt", "CAO", "MEDIO", 18, ["energético", "sociável"], "DISPONIVEL", -21.26, -45.01],
  ["Nina", "CAO", "PEQUENO", 120, ["idosa", "carinhosa"], "DISPONIVEL", -21.242, -45.008],
  ["Frajola", "GATO", "MEDIO", 60, ["tranquilo"], "INDISPONIVEL", -21.235, -45.015],
];

export const animais: AnimalPainel[] = base.map(([nome, especie, porte, idadeMeses, temperamento, status, lat, lng], i) => ({
  id: oid(),
  nome,
  especie,
  porte,
  sexo: i % 2 ? "MACHO" : "FEMEA",
  idadeMeses,
  descricao: `${nome} está sob os cuidados da ONG Patinhas de Lavras.`,
  endereco: { ...ENDERECO, bairro: ["Centro", "Jardim Floresta", "Vila Esperança", "Aquenta Sol"][i % 4] },
  temperamento,
  fotos: FOTOS_DEMO[nome] ? [FOTOS_DEMO[nome]] : [],
  fotoCapa: FOTOS_DEMO[nome] ?? null,
  localizacao: lavras(lat, lng, ["Centro", "Jardim Floresta", "Vila Esperança", "Aquenta Sol"][i % 4]),
  status,
  historicoStatus: [{ status: "DISPONIVEL", em: ha(200 - i * 10), por: "RESPONSAVEL" }, ...(status !== "DISPONIVEL" ? [{ status, em: ha(30 - i), por: (status === "RESERVADO" || status === "ADOTADO" ? "SAGA" : "RESPONSAVEL") as "SAGA" | "RESPONSAVEL" }] : [])],
  atualizadoEm: ha(30 - i),
  solicitacoes: [],
  avisos: [],
}));

const adotantes = [
  { id: "00000000-0000-4000-8000-0000000000d1", nome: "Bruna Silva", cidade: "Lavras", perfil: { tipoMoradia: "CASA" as const, temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4, completo: true } },
  { id: novoUuid(), nome: "Carlos Souza", cidade: "Lavras", perfil: { tipoMoradia: "APARTAMENTO" as const, temQuintal: false, outrosAnimais: true, horasForaDeCasa: 10, completo: true } },
  { id: novoUuid(), nome: "Helena Prado", cidade: "Ijaci", perfil: { tipoMoradia: "SITIO" as const, temQuintal: true, outrosAnimais: true, horasForaDeCasa: 2, completo: true } },
  { id: novoUuid(), nome: "Davi Moreira", cidade: "Lavras", perfil: null },
];

function solicitacao(animalIdx: number, adotanteIdx: number, estado: EstadoSolicitacao, criadaHaH: number, historico: [EstadoSolicitacao | null, EstadoSolicitacao, string, number][], desfecho: string | null = null, motivo: string | null = null): SolicitacaoDetalhe {
  const id = novoUuid();
  const a = animais[animalIdx];
  return {
    id,
    estado,
    desfecho,
    motivo,
    expiraEm: estado === "AGUARDANDO_APROVACAO" ? daqui(48) : ha(criadaHaH - 72),
    criadoEm: ha(criadaHaH),
    animal: { id: a.id, nome: a.nome, fotoCapa: a.fotoCapa },
    adotante: adotantes[adotanteIdx],
    historico: historico.map(([de, para, evento, h]) => ({ de, para, evento, em: ha(h) })),
    _links: { self: { href: `/web/v1/solicitacoes/${id}` }, animal: { href: `/web/v1/animais/${a.id}` } },
    avisos: [],
  };
}

export const solicitacoes: SolicitacaoDetalhe[] = [
  solicitacao(0, 0, "AGUARDANDO_APROVACAO", 3, [
    [null, "SOLICITADA", "adocao.solicitada", 3],
    ["SOLICITADA", "ANIMAL_RESERVADO", "animal.reservado", 2.99],
    ["ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "perfil.validado", 2.98],
  ]),
  solicitacao(1, 2, "AGUARDANDO_APROVACAO", 20, [
    [null, "SOLICITADA", "adocao.solicitada", 20],
    ["SOLICITADA", "ANIMAL_RESERVADO", "animal.reservado", 19.99],
    ["ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "perfil.validado", 19.98],
  ]),
  solicitacao(4, 2, "CONCLUIDA", 120, [
    [null, "SOLICITADA", "adocao.solicitada", 120],
    ["SOLICITADA", "ANIMAL_RESERVADO", "animal.reservado", 119.9],
    ["ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "perfil.validado", 119.8],
    ["AGUARDANDO_APROVACAO", "APROVADA", "adocao.aprovada", 100],
    ["APROVADA", "CONCLUIDA", "adocao.concluida", 99.9],
  ]),
  solicitacao(0, 1, "RECUSADA", 60, [
    [null, "SOLICITADA", "adocao.solicitada", 60],
    ["SOLICITADA", "ANIMAL_RESERVADO", "animal.reservado", 59.9],
    ["ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "perfil.validado", 59.8],
    ["AGUARDANDO_APROVACAO", "RECUSADA", "adocao.recusada", 50],
  ], "RECUSADA", "A rotina informada deixa o animal sozinho por muitas horas."),
  solicitacao(5, 3, "PERFIL_INVALIDO", 30, [
    [null, "SOLICITADA", "adocao.solicitada", 30],
    ["SOLICITADA", "ANIMAL_RESERVADO", "animal.reservado", 29.99],
    ["ANIMAL_RESERVADO", "COMPENSANDO", "perfil.invalido", 29.98],
    ["COMPENSANDO", "PERFIL_INVALIDO", "animal.liberado", 29.97],
  ], "PERFIL_INVALIDO"),
];

export const contas: ContaResumo[] = [
  { id: novoUuid(), nome: "Abrigo Quatro Patas", role: "ONG", cidade: "Perdões", statusVerificacao: "PENDENTE_VERIFICACAO" },
  { id: novoUuid(), nome: "Marcos Lemos", role: "PROTETOR", cidade: "Lavras", statusVerificacao: "PENDENTE_VERIFICACAO" },
  { id: novoUuid(), nome: "SOS Bichos Ijaci", role: "ONG", cidade: "Ijaci", statusVerificacao: "PENDENTE_VERIFICACAO" },
  { id: "00000000-0000-4000-8000-0000000000a1", nome: "ONG Patinhas de Lavras", role: "ONG", cidade: "Lavras", statusVerificacao: "VERIFICADA" },
];

// Links HATEOAS como o BFF manda: aprovar e recusar só em AGUARDANDO_APROVACAO.
export function comLinks<T extends SolicitacaoDetalhe>(s: T): T {
  const links = { ...s._links };
  delete links.aprovar;
  delete links.recusar;
  if (s.estado === "AGUARDANDO_APROVACAO") {
    links.aprovar = { href: `/web/v1/solicitacoes/${s.id}/aprovacao`, method: "POST" };
    links.recusar = { href: `/web/v1/solicitacoes/${s.id}/recusa`, method: "POST" };
  }
  return { ...s, _links: links };
}

export function solicitacoesDoAnimal(animalId: string) {
  return solicitacoes
    .filter((s) => s.animal?.id === animalId)
    .map((s) => {
      const { id, estado, desfecho, expiraEm, criadoEm, adotante, _links } = comLinks(s);
      return { id, estado, desfecho, expiraEm, criadoEm, adotante, _links };
    });
}

export function resumo(a: AnimalPainel): AnimalResumo {
  const ativas = solicitacoes.filter((s) => s.animal?.id === a.id && ["SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA"].includes(s.estado)).length;
  return { id: a.id, nome: a.nome, especie: a.especie, porte: a.porte, status: a.status, fotoCapa: a.fotoCapa, solicitacoesAtivas: ativas, atualizadoEm: a.atualizadoEm };
}

export function atualizar(a: AnimalPainel, d: AnimalEntrada) {
  Object.assign(a, {
    nome: d.nome,
    especie: d.especie,
    porte: d.porte,
    sexo: d.sexo,
    idadeMeses: d.idadeMeses,
    temperamento: d.temperamento ?? [],
    descricao: d.descricao ?? null,
    fotos: d.fotos,
    fotoCapa: d.fotos[0] ?? null,
    localizacao: { ...d.localizacao, bairro: d.endereco.bairro, cidade: d.endereco.cidade },
    endereco: d.endereco,
    atualizadoEm: new Date().toISOString(),
  });
}

export function novoAnimal(dados: AnimalEntrada): AnimalPainel {
  const a: AnimalPainel = {
    ...dados,
    descricao: dados.descricao ?? null,
    localizacao: { ...dados.localizacao, bairro: dados.endereco.bairro, cidade: dados.endereco.cidade },
    id: oid(),
    temperamento: dados.temperamento ?? [],
    fotoCapa: dados.fotos[0] ?? null,
    status: "DISPONIVEL",
    historicoStatus: [{ status: "DISPONIVEL", em: new Date().toISOString(), por: "RESPONSAVEL" }],
    atualizadoEm: new Date().toISOString(),
    solicitacoes: [],
    avisos: [],
  };
  animais.unshift(a);
  return a;
}

export function painel(): Painel {
  const porStatus: Painel["animais"] = { total: animais.length, porStatus: {} };
  for (const a of animais) porStatus.porStatus[a.status] = (porStatus.porStatus[a.status] ?? 0) + 1;
  const porEstado: Record<string, number> = {};
  for (const s of solicitacoes) porEstado[s.estado] = (porEstado[s.estado] ?? 0) + 1;
  return {
    animais: porStatus,
    solicitacoes: {
      aguardandoAprovacao: porEstado.AGUARDANDO_APROVACAO ?? 0,
      porEstado,
      concluidasNoMes: porEstado.CONCLUIDA ?? 0,
    },
    avisos: [],
  };
}

// Avança a SAGA simulada como o orquestrador faria depois de uma decisão.
export function decidir(id: string, decisao: "aprovar" | "recusar", motivo?: string) {
  const s = solicitacoes.find((x) => x.id === id);
  if (!s) return null;
  const animal = animais.find((a) => a.id === s.animal?.id);
  const em = () => new Date().toISOString();
  if (decisao === "aprovar") {
    s.historico.push({ de: s.estado, para: "APROVADA", evento: "adocao.aprovada", em: em() });
    s.estado = "APROVADA";
    setTimeout(() => {
      s.historico.push({ de: "APROVADA", para: "CONCLUIDA", evento: "adocao.concluida", em: em() });
      s.estado = "CONCLUIDA";
      if (animal) {
        animal.status = "ADOTADO";
        animal.historicoStatus.push({ status: "ADOTADO", em: em(), por: "SAGA" });
      }
    }, 2500);
  } else {
    s.historico.push({ de: s.estado, para: "COMPENSANDO", evento: "adocao.recusada", em: em() });
    s.estado = "COMPENSANDO";
    s.motivo = motivo ?? null;
    setTimeout(() => {
      s.historico.push({ de: "COMPENSANDO", para: "RECUSADA", evento: "animal.liberado", em: em() });
      s.estado = "RECUSADA";
      s.desfecho = "RECUSADA";
      if (animal) {
        animal.status = "DISPONIVEL";
        animal.historicoStatus.push({ status: "DISPONIVEL", em: em(), por: "SAGA" });
      }
    }, 2500);
  }
  return comLinks(s);
}
