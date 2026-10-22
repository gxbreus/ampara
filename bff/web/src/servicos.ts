import type { FastifyRequest } from "fastify";
import type { Cliente } from "./cliente.js";

// Como o BFF trata a resposta de cada serviço (docs/contratos/bff-web.v1.yaml, "Falha parcial"):
// - o serviço essencial da rota que não responde vira 503 na rota inteira;
// - um serviço complementar que não responde vira um item em `avisos` e campos null.
// Nunca 500 por falha de outro serviço.

export type NomeServico = "identidade" | "animais" | "adocao";
export type MotivoFalha = "TIMEOUT" | "INDISPONIVEL";

export interface Aviso {
  servico: NomeServico;
  motivo: MotivoFalha;
}

const nomes: Record<NomeServico, string> = { identidade: "Identidade", animais: "Animais", adocao: "Adoção" };

// O essencial não respondeu, respondeu 5xx ou estourou o timeout.
export class ServicoIndisponivel extends Error {
  constructor(
    readonly servico: NomeServico,
    readonly motivo: MotivoFalha,
  ) {
    super(`${nomes[servico]} não respondeu.`);
  }
}

// O essencial respondeu 4xx (404, 409, 422...): o BFF devolve o mesmo erro ao painel.
export class RespostaDoServico extends Error {
  constructor(
    readonly status: number,
    readonly corpo: string,
    readonly tipo: string,
  ) {
    super(`serviço respondeu ${status}`);
  }
}

// O AbortSignal.timeout do cliente rejeita com um DOMException chamado TimeoutError.
function motivoDoErro(erro: unknown): MotivoFalha {
  return erro instanceof DOMException && erro.name === "TimeoutError" ? "TIMEOUT" : "INDISPONIVEL";
}

export async function essencial<T>(
  chamar: Cliente,
  servico: NomeServico,
  url: string,
  req: FastifyRequest,
  init?: RequestInit,
): Promise<T> {
  let resp: Response;
  try {
    resp = await chamar(url, req, init);
  } catch (erro) {
    throw new ServicoIndisponivel(servico, motivoDoErro(erro));
  }
  if (resp.status >= 500) throw new ServicoIndisponivel(servico, "INDISPONIVEL");
  if (!resp.ok) {
    throw new RespostaDoServico(resp.status, await resp.text(), resp.headers.get("content-type") ?? "application/problem+json");
  }
  return (await resp.json()) as T;
}

// Devolve null e registra o aviso quando o serviço não responde ou responde erro.
export async function complementar<T>(
  chamar: Cliente,
  servico: NomeServico,
  url: string,
  req: FastifyRequest,
  avisos: Aviso[],
): Promise<T | null> {
  try {
    const resp = await chamar(url, req);
    if (resp.ok) return (await resp.json()) as T;
    avisos.push({ servico, motivo: "INDISPONIVEL" });
  } catch (erro) {
    avisos.push({ servico, motivo: motivoDoErro(erro) });
  }
  return null;
}
