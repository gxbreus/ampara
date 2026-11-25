// Uma função por rota do contrato do BFF Mobile, cada uma real ou simulada pelo grupo.
import { claimsDoToken, criarRotas, ErroApi, http, simular } from "@c/api";
import * as m from "./mocks";
import type {
  AnimalCard,
  AnimalDetalhe,
  FiltroBusca,
  LinhaDoTempo,
  MinhaConta,
  Notificacao,
  PaginaBusca,
  PerfilAdocao,
  RespostaPergunta,
  RespostaRecomendacao,
  SolicitacaoCriada,
  SolicitacaoDetalhe,
  SolicitacaoResumo,
} from "./tipos";

// #158 e #149 integrados: as jornadas do adotante usam os serviços reais.
// Notificações continuam simuladas até a implementação de #60.
export type Grupo = "auth" | "busca" | "detalhe" | "solicitacoes" | "notificacoes" | "conta" | "assistente";
const PADRAO_REAIS: Grupo[] = ["auth", "busca", "detalhe", "solicitacoes", "conta", "assistente"];
export const rotas = criarRotas<Grupo>(PADRAO_REAIS);

const naoEncontrado = (o: string) => new ErroApi(404, "Não encontrado", `Não existe ${o} com este identificador.`);

// Os cartões da última busca, para o detalhe simulado mostrar o animal real que a pessoa tocou.
const cartoesVistos = new Map<string, AnimalCard>();
let contextoBusca: Pick<FiltroBusca, "lat" | "lng" | "raioKm"> | undefined;

// ---------- autenticação ----------

export async function entrar(email: string, senha: string): Promise<{ token: string; conta: MinhaConta }> {
  if (rotas.real("auth")) {
    const s = await http<{ accessToken: string; claims?: { sub: string; role: string }; conta?: MinhaConta & { role: string } }>("/auth/v1/sessoes", {
      method: "POST",
      corpo: { email, senha },
      publico: true,
    });
    const claims = s.claims ?? claimsDoToken(s.accessToken)!;
    if (claims.role !== "ADOTANTE") throw new ErroApi(403, "Conta de ONG ou protetor", "Este app é dos adotantes. Use o painel web (porta 5173).");
    const conta: MinhaConta = s.conta ? { ...s.conta, role: "ADOTANTE" } : { id: claims.sub, nome: email.split("@")[0], email, role: "ADOTANTE", cidade: "" };
    return { token: s.accessToken, conta };
  }
  return simular({ token: "simulado", conta: { id: "00000000-0000-4000-8000-0000000000d1", nome: "Bruna Silva", email, role: "ADOTANTE" as const, cidade: "Lavras" } });
}

export async function cadastrar(dados: { nome: string; email: string; senha: string; cidade: string }) {
  const corpo = { ...dados, tipo: "ADOTANTE" };
  if (rotas.real("auth")) return http<MinhaConta>("/auth/v1/contas", { method: "POST", corpo, publico: true });
  return simular<MinhaConta>({ id: crypto.randomUUID(), nome: dados.nome, email: dados.email, role: "ADOTANTE", cidade: dados.cidade });
}

// ---------- busca e detalhe ----------

export async function buscar(f: FiltroBusca): Promise<PaginaBusca> {
  let pagina: PaginaBusca;
  if (rotas.real("busca")) {
    const q = new URLSearchParams({ lat: String(f.lat), lng: String(f.lng), raioKm: String(f.raioKm), limite: "20" });
    if (f.especie) q.set("especie", f.especie);
    if (f.porte) q.set("porte", f.porte);
    if (f.idadeMaxMeses != null) q.set("idadeMaxMeses", String(f.idadeMaxMeses));
    if (f.cursor) q.set("cursor", f.cursor);
    const bruta = await http<PaginaBusca>(`/mobile/v1/animais?${q}`, { publico: true });
    // Normaliza miniatura ausente para os componentes de apresentação.
    pagina = { ...bruta, itens: bruta.itens.map((c) => ({ ...c, fotoThumb: c.fotoThumb ?? "", minhaSolicitacao: c.minhaSolicitacao ?? null })) };
  } else {
    pagina = await simular(() => ({
      itens: m.animais
        .filter((a) => a.status === "DISPONIVEL" || m.minhaAtiva(a.id))
        .filter((a) => !f.especie || a.especie === f.especie)
        .filter((a) => !f.porte || a.porte === f.porte)
        .filter((a) => f.idadeMaxMeses == null || a.idadeMeses <= f.idadeMaxMeses)
        .map((a) => m.cartao(a, f.lat, f.lng))
        .filter((c) => c.distanciaKm <= f.raioKm)
        .sort((a, b) => a.distanciaKm - b.distanciaKm),
      proximoCursor: null,
      avisos: [],
    }));
  }
  for (const c of pagina.itens) cartoesVistos.set(c.id, c);
  contextoBusca = { lat: f.lat, lng: f.lng, raioKm: f.raioKm };
  return pagina;
}

export async function obterAnimal(id: string): Promise<AnimalDetalhe> {
  if (rotas.real("detalhe")) return http(`/mobile/v1/animais/${id}`, { publico: true });
  return simular(() => {
    const a = m.animais.find((x) => x.id === id);
    if (a) {
      const { lat: _lat, lng: _lng, ...publico } = a;
      return { ...publico, minhaSolicitacao: m.minhaAtiva(id), avisos: [] };
    }
    // animal da busca real: monta a ficha com o que o cartão já trouxe
    const c = cartoesVistos.get(id);
    if (!c) throw naoEncontrado("animal");
    const extra = c as AnimalCard & { sexo?: AnimalDetalhe["sexo"]; idadeMeses?: number; bairro?: string; responsavel?: AnimalDetalhe["responsavel"]; temperamento?: string[]; descricao?: string };
    return {
      id: c.id,
      nome: c.nome,
      especie: c.especie ?? "CAO",
      porte: c.porte,
      sexo: extra.sexo ?? "FEMEA",
      idadeMeses: extra.idadeMeses ?? 12,
      temperamento: extra.temperamento ?? [],
      descricao: extra.descricao,
      fotos: c.fotoThumb ? [c.fotoThumb] : [],
      fotoThumb: c.fotoThumb,
      bairro: extra.bairro ?? "",
      cidade: c.cidade,
      responsavel: extra.responsavel ?? { id: "", nome: "ONG responsável", verificado: true },
      status: "DISPONIVEL",
      minhaSolicitacao: m.minhaAtiva(id) ?? c.minhaSolicitacao,
      atualizadoEm: c.atualizadoEm,
      avisos: [],
    };
  });
}

// ---------- solicitações ----------

export async function solicitar(animalId: string, chave: string): Promise<SolicitacaoCriada> {
  if (rotas.real("solicitacoes")) return http("/mobile/v1/solicitacoes", { method: "POST", corpo: { animalId }, headers: { "Idempotency-Key": chave } });
  return simular(() => {
    const ativa = m.minhaAtiva(animalId);
    if (ativa) throw new ErroApi(409, "Pedido já existe", "Você já tem um pedido ativo para este animal.");
    const s = m.criarSolicitacao(animalId, cartoesVistos.get(animalId));
    return { id: s.id, estado: s.estado, animalId, criadoEm: s.criadoEm };
  });
}

export async function minhasSolicitacoes(): Promise<{ itens: SolicitacaoResumo[]; avisos?: string[] }> {
  if (rotas.real("solicitacoes")) return http("/mobile/v1/solicitacoes");
  return simular(() => ({ itens: m.solicitacoes.map(({ id, estado, criadoEm, expiraEm, animal }) => ({ id, estado, criadoEm, expiraEm, animal })), avisos: [] }));
}

export async function obterSolicitacao(id: string): Promise<SolicitacaoDetalhe> {
  if (rotas.real("solicitacoes")) {
    const s = await http<SolicitacaoDetalhe>(`/mobile/v1/solicitacoes/${id}`);
    return { ...s, podeCancelar: !!s._links?.cancelar };
  }
  const animal = await (async () => {
    const s = m.solicitacoes.find((x) => x.id === id);
    if (!s) throw naoEncontrado("solicitação");
    return obterAnimal(s.animalId);
  })();
  return simular(() => {
    const s = m.solicitacoes.find((x) => x.id === id)!;
    return { id: s.id, estado: s.estado, criadoEm: s.criadoEm, expiraEm: s.expiraEm, animal, podeCancelar: ["SOLICITADA", "ANIMAL_RESERVADO", "AGUARDANDO_APROVACAO"].includes(s.estado), avisos: [] };
  }, 150);
}

export async function linhaDoTempo(id: string): Promise<LinhaDoTempo> {
  if (rotas.real("solicitacoes")) return http(`/mobile/v1/solicitacoes/${id}/linha-do-tempo`);
  return simular(() => {
    const s = m.solicitacoes.find((x) => x.id === id);
    if (!s) throw naoEncontrado("solicitação");
    return { solicitacaoId: id, etapas: s.etapas };
  }, 150);
}

export async function cancelar(id: string, motivo?: string): Promise<{ id: string; estado: string }> {
  if (rotas.real("solicitacoes")) {
    const s = await obterSolicitacao(id);
    const acao = s._links?.cancelar;
    if (!acao) throw new ErroApi(409, "Ação indisponível", "Este pedido não pode mais ser cancelado.");
    return http(acao.href, { method: acao.method ?? "POST", corpo: motivo ? { motivo } : {} });
  }
  return simular(() => {
    const s = m.cancelar(id);
    if (!s) throw naoEncontrado("solicitação");
    return { id: s.id, estado: s.estado };
  });
}

// ---------- notificações ----------

export async function notificacoes(): Promise<{ itens: Notificacao[] }> {
  if (rotas.real("notificacoes")) return http("/mobile/v1/notificacoes");
  return simular(() => ({ itens: m.notificacoes }), 150);
}

export async function marcarLida(id: string) {
  if (rotas.real("notificacoes")) return http<void>(`/mobile/v1/notificacoes/${id}/leitura`, { method: "POST" });
  return simular(() => {
    const n = m.notificacoes.find((x) => x.id === id);
    if (n) n.lida = true;
  }, 100);
}

export async function marcarTodas() {
  if (rotas.real("notificacoes")) return http<void>("/mobile/v1/notificacoes/leitura-todas", { method: "POST" });
  return simular(() => m.notificacoes.forEach((n) => (n.lida = true)), 100);
}

// ---------- conta e perfil ----------

export async function eu(guardada: MinhaConta | null): Promise<MinhaConta> {
  if (rotas.real("conta")) return http("/mobile/v1/eu");
  if (!guardada) throw new ErroApi(401, "Não autenticado", "Entre de novo.");
  return simular(guardada, 100);
}

export async function perfilAdocao(): Promise<PerfilAdocao> {
  if (rotas.real("conta")) return http("/mobile/v1/eu/perfil-adocao");
  return simular(() => ({ ...m.perfil, completo: m.completo(m.perfil) }));
}

export async function salvarPerfil(p: Omit<PerfilAdocao, "completo">): Promise<PerfilAdocao> {
  if (rotas.real("conta")) return http("/mobile/v1/eu/perfil-adocao", { method: "PUT", corpo: p });
  return simular(() => {
    Object.assign(m.perfil, p);
    m.perfil.completo = m.completo(m.perfil);
    return { ...m.perfil };
  });
}

// ---------- assistente ----------

export async function perguntar(pergunta: string): Promise<RespostaPergunta> {
  if (rotas.real("assistente")) return http("/mobile/v1/assistente/perguntas", { method: "POST", corpo: { pergunta } });
  return simular(() => m.responder(pergunta), 900 + Math.random() * 700);
}

export async function recomendar(descricaoRotina: string): Promise<RespostaRecomendacao> {
  if (rotas.real("assistente")) {
    if (!contextoBusca) throw new ErroApi(400, "Localização necessária", "Faça uma busca por animais para escolher a localização e o raio antes de pedir recomendações.");
    return http("/mobile/v1/assistente/recomendacoes", { method: "POST", corpo: { descricaoRotina, ...contextoBusca } });
  }
  return simular(() => m.recomendar(descricaoRotina), 1200 + Math.random() * 800);
}
