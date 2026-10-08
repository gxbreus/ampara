import type { FastifyRequest } from "fastify";
import { Agent } from "undici";
import { criarLookup } from "./dns.js";

// Cliente para os serviços internos. Toda chamada repassa o X-Correlation-Id e o
// Authorization original (não existe X-Usuario: cada serviço lê o sub e a role do JWT)
// e tem timeout: sem ele, um serviço lento prenderia as conexões do BFF inteiro.
//
// Os nomes são resolvidos sem o pool de threads do Node (ver src/dns.ts).

// O undici repassa as opções de connect ao net.connect, que aceita lookup; o tipo exige
// campos (port, host) que o undici preenche sozinho por conexão.
const agente = new Agent({ connect: { lookup: criarLookup() } as unknown as Agent.Options["connect"] });

export function criarCliente(timeoutMs: number) {
  return async function chamar(url: string, req: FastifyRequest, init: RequestInit = {}): Promise<Response> {
    const cabecalhos = new Headers(init.headers);
    cabecalhos.set("X-Correlation-Id", req.id);
    if (req.headers.authorization) cabecalhos.set("Authorization", req.headers.authorization);
    return fetch(url, {
      ...init,
      headers: cabecalhos,
      signal: AbortSignal.timeout(timeoutMs),
      // @ts-expect-error: o fetch do Node aceita o dispatcher do undici, mas o tipo do DOM não o declara
      dispatcher: agente,
    });
  };
}

export type Cliente = ReturnType<typeof criarCliente>;
