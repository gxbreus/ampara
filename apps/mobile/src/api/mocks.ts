// Dados simulados do app do adotante, no formato do contrato do BFF Mobile. A SAGA anda
// sozinha em memória (reserva → valida perfil → espera a ONG → aprova), e cada passo gera
// uma notificação, para dar para ensaiar a demo sem backend.
import { novoUuid } from "@c/api";
import type { AnimalCard, AnimalDetalhe, LinhaDoTempo, Notificacao, PerfilAdocao, SolicitacaoResumo } from "./tipos";

const agora = Date.now();
const ha = (h: number) => new Date(agora - h * 3600_000).toISOString();
const oid = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

const ONG = { id: "00000000-0000-4000-8000-0000000000a1", nome: "ONG Patinhas de Lavras", verificado: true };

type Linha = [string, AnimalDetalhe["especie"], AnimalDetalhe["porte"], AnimalDetalhe["sexo"], number, string[], number, number, string, string];
const base: Linha[] = [
  ["Paçoca", "CAO", "MEDIO", "FEMEA", 24, ["dócil", "brincalhona"], -21.2449, -45.0003, "Centro", "Vira-lata caramelo que adora colo e passeios curtos."],
  ["Thor", "CAO", "GRANDE", "MACHO", 48, ["protetor", "calmo"], -21.239, -44.996, "Jardim Floresta", "Grandão tranquilo, ótimo com crianças maiores."],
  ["Mel", "GATO", "PEQUENO", "FEMEA", 8, ["curiosa"], -21.251, -45.005, "Vila Esperança", "Filhote de gata, explora tudo e dorme no sol."],
  ["Biscoito", "CAO", "PEQUENO", "MACHO", 6, ["filhote", "agitado"], -21.23, -44.99, "Aquenta Sol", "Filhote cheio de energia, precisa de espaço para brincar."],
  ["Luna", "GATO", "PEQUENO", "FEMEA", 36, ["independente"], -21.247, -44.985, "Centro", "Gata adulta e independente, ideal para apartamento."],
  ["Bolt", "CAO", "MEDIO", "MACHO", 18, ["energético", "sociável"], -21.26, -45.01, "Jardim Floresta", "Companheiro de corrida, se dá bem com outros cães."],
  ["Nina", "CAO", "PEQUENO", "FEMEA", 120, ["idosa", "carinhosa"], -21.242, -45.008, "Vila Esperança", "Senhorinha doce que só quer um sofá e carinho."],
  ["Frajola", "GATO", "MEDIO", "MACHO", 60, ["tranquilo"], -21.235, -45.015, "Aquenta Sol", "Gato preto e branco, calmo e muito educado."],
];

export const animais: (AnimalDetalhe & { lat: number; lng: number })[] = base.map(([nome, especie, porte, sexo, idadeMeses, temperamento, lat, lng, bairro, descricao], i) => ({
  id: oid(),
  nome,
  especie,
  porte,
  sexo,
  idadeMeses,
  temperamento,
  descricao,
  fotos: [],
  fotoThumb: "",
  bairro,
  cidade: "Lavras",
  responsavel: ONG,
  status: "DISPONIVEL",
  minhaSolicitacao: null,
  atualizadoEm: ha(10 + i),
  lat,
  lng,
}));

export function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (g: number) => (g * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

export function cartao(a: (typeof animais)[number], lat: number, lng: number): AnimalCard {
  return {
    id: a.id,
    nome: a.nome,
    fotoThumb: a.fotoThumb,
    porte: a.porte,
    distanciaKm: distanciaKm(lat, lng, a.lat, a.lng),
    cidade: a.cidade,
    minhaSolicitacao: minhaAtiva(a.id),
    atualizadoEm: a.atualizadoEm,
    especie: a.especie,
  };
}

// ---------- perfil ----------
export const perfil: PerfilAdocao = { tipoMoradia: "CASA", temQuintal: true, outrosAnimais: false, horasForaDeCasa: 4, aceiteTermo: true, completo: true };

export function completo(p: PerfilAdocao) {
  return !!p.tipoMoradia && p.aceiteTermo === true;
}

// ---------- solicitações e SAGA simulada ----------
interface SolicitacaoMock extends SolicitacaoResumo {
  animalId: string;
  etapas: LinhaDoTempo["etapas"];
}
export const solicitacoes: SolicitacaoMock[] = [];
export const notificacoes: Notificacao[] = [
  { id: novoUuid(), titulo: "Bem-vinda à Ampara", mensagem: "Complete o seu perfil de adoção para poder pedir um animal.", lida: true, criadoEm: ha(30) },
];

const ATIVOS = new Set(["SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO", "APROVADA", "COMPENSANDO"]);
export const ehAtiva = (estado: string) => ATIVOS.has(estado);

export function minhaAtiva(animalId: string) {
  const s = solicitacoes.find((x) => x.animalId === animalId && ehAtiva(x.estado));
  return s ? { id: s.id, estado: s.estado } : null;
}

function avisar(titulo: string, mensagem: string) {
  notificacoes.unshift({ id: novoUuid(), titulo, mensagem, lida: false, criadoEm: new Date().toISOString() });
}

function passo(s: SolicitacaoMock, estado: string, etapa: string, descricao: string) {
  if (!ehAtiva(s.estado) && s.estado !== "SOLICITADA") return false;
  s.estado = estado;
  s.etapas.push({ etapa, descricao, concluidaEm: new Date().toISOString() });
  return true;
}

// `visto` é o cartão da busca, para animais que vieram do backend real e não estão nesta lista.
export function criarSolicitacao(animalId: string, visto?: { nome: string; porte: AnimalDetalhe["porte"]; cidade: string; fotoThumb: string }) {
  const animal = animais.find((a) => a.id === animalId);
  const s: SolicitacaoMock = {
    id: novoUuid(),
    estado: "SOLICITADA",
    criadoEm: new Date().toISOString(),
    animalId,
    animal: { id: animalId, nome: animal?.nome ?? visto?.nome, fotoThumb: animal?.fotoThumb ?? visto?.fotoThumb, porte: animal?.porte ?? visto?.porte, cidade: animal?.cidade ?? visto?.cidade },
    etapas: [{ etapa: "SOLICITADA", descricao: "Recebemos o seu pedido.", concluidaEm: new Date().toISOString() }],
  };
  solicitacoes.unshift(s);
  const nome = animal?.nome ?? visto?.nome ?? "o animal";

  setTimeout(() => {
    if (!passo(s, "ANIMAL_RESERVADO", "ANIMAL_RESERVADO", `${nome} foi reservado para o seu pedido.`)) return;
    if (animal) animal.status = "RESERVADO";
    avisar("Reserva feita", `${nome} está reservado enquanto o pedido anda.`);
    setTimeout(() => {
      if (!completo(perfil)) {
        passo(s, "COMPENSANDO", "PERFIL_INVALIDO", "O seu perfil de adoção está incompleto. Desfazendo a reserva.");
        setTimeout(() => {
          s.estado = "PERFIL_INVALIDO";
          s.etapas.push({ etapa: "ANIMAL_LIBERADO", descricao: `${nome} voltou para a busca.`, concluidaEm: new Date().toISOString() });
          if (animal) animal.status = "DISPONIVEL";
          avisar("Pedido não seguiu", "Complete o perfil de adoção e peça de novo.");
        }, 1500);
        return;
      }
      if (!passo(s, "AGUARDANDO_APROVACAO", "PERFIL_VALIDADO", "Perfil validado. Agora a ONG avalia o pedido.")) return;
      s.expiraEm = new Date(Date.now() + 72 * 3600_000).toISOString();
      avisar("Perfil validado", `A ${ONG.nome} vai avaliar o seu pedido por ${nome}.`);
      // a ONG decide alguns segundos depois, para a demo mostrar o fluxo inteiro
      setTimeout(() => {
        if (!passo(s, "APROVADA", "APROVADA", `A ${ONG.nome} aprovou o seu pedido!`)) return;
        avisar("Pedido aprovado 🎉", `A ${ONG.nome} aprovou a adoção de ${nome}.`);
        setTimeout(() => {
          if (!passo(s, "CONCLUIDA", "CONCLUIDA", "Adoção concluída. Combine a busca com a ONG.")) return;
          if (animal) animal.status = "ADOTADO";
        }, 2000);
      }, 12_000);
    }, 1800);
  }, 1500);
  return s;
}

export function cancelar(id: string) {
  const s = solicitacoes.find((x) => x.id === id);
  if (!s) return null;
  const animal = animais.find((a) => a.id === s.animalId);
  s.estado = "COMPENSANDO";
  s.etapas.push({ etapa: "CANCELAMENTO_PEDIDO", descricao: "Você desistiu do pedido. Desfazendo a reserva.", concluidaEm: new Date().toISOString() });
  setTimeout(() => {
    s.estado = "CANCELADA";
    s.etapas.push({ etapa: "ANIMAL_LIBERADO", descricao: `${animal?.nome ?? "O animal"} voltou para a busca.`, concluidaEm: new Date().toISOString() });
    if (animal) animal.status = "DISPONIVEL";
  }, 1500);
  return s;
}

// ---------- assistente ----------
const RESPOSTAS: [RegExp, string, { titulo: string; paginaOuSecao: string }[]][] = [
  [/filhote|primeiro|cuidado/i, "Nos primeiros dias, prepare um canto calmo com água, comida e um lugar para dormir. Leve ao veterinário na primeira semana para checar vacinas e vermífugo, e apresente a casa aos poucos.", [{ titulo: "Guia de posse responsável", paginaOuSecao: "Cap. 2 · Chegada em casa" }, { titulo: "Calendário de vacinação", paginaOuSecao: "Filhotes até 4 meses" }]],
  [/apartamento|espaço|pequeno/i, "Dá para ter cão ou gato em apartamento. Gatos adultos e cães pequenos ou calmos se adaptam bem, desde que tenham passeios diários (cães) e telas nas janelas (gatos).", [{ titulo: "Guia de posse responsável", paginaOuSecao: "Cap. 4 · Moradia" }]],
  [/castra/i, "A castração evita ninhadas indesejadas e reduz fugas e algumas doenças. Pode ser feita a partir dos 6 meses, com avaliação do veterinário.", [{ titulo: "Cartilha de castração", paginaOuSecao: "Por que castrar" }]],
];

export function responder(pergunta: string) {
  const achada = RESPOSTAS.find(([re]) => re.test(pergunta));
  if (!achada) {
    return {
      resposta: "Não encontrei isso na base de guias. Procure o veterinário ou a ONG responsável pelo animal para essa dúvida.",
      fontes: [],
      degradado: false,
    };
  }
  return { resposta: achada[1], fontes: achada[2], degradado: false };
}

export function recomendar(rotina: string) {
  const apto = /apartamento|pequeno/i.test(rotina);
  const ativo = /corr|caminh|parque|ativ|esporte/i.test(rotina);
  const fora = /(\d+)\s*h/i.exec(rotina);
  const horas = fora ? Number(fora[1]) : 6;
  const escolhidos = animais
    .filter((a) => a.status === "DISPONIVEL")
    .filter((a) => (apto ? a.porte !== "GRANDE" : true))
    .filter((a) => (horas >= 8 ? a.especie === "GATO" || a.idadeMeses > 24 : true))
    .sort((a, b) => (ativo ? Number(b.temperamento?.includes("energético")) - Number(a.temperamento?.includes("energético")) : a.idadeMeses - b.idadeMeses))
    .slice(0, 3);
  return {
    animais: escolhidos.map((a) => ({
      animalId: a.id,
      nome: a.nome,
      fotoThumb: a.fotoThumb || undefined,
      motivoRecomendacao: `${a.especie === "GATO" ? "Gato" : "Cão"} de porte ${a.porte.toLowerCase()}, ${a.temperamento?.join(" e ")}${apto ? ", combina com apartamento" : ""}.`,
    })),
    explicacao: `Considerei ${apto ? "a moradia em apartamento" : "a sua moradia"}, cerca de ${horas} h fora de casa${ativo ? " e o gosto por atividade ao ar livre" : ""}.`,
    degradado: false,
  };
}
