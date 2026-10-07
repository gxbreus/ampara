import type { FastifyRequest } from "fastify";
import type { LookupAddress } from "node:dns";
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";

// Cliente para os serviços internos. Toda chamada repassa o X-Correlation-Id e o
// Authorization original (não existe X-Usuario: cada serviço lê o sub e a role do JWT)
// e tem timeout: sem ele, um serviço lento prenderia as conexões do BFF inteiro.
//
// Os nomes são resolvidos pelo dns.Resolver (c-ares), e não pelo dns.lookup padrão. O
// lookup usa o pool de threads do Node, de 4 threads, e um nome que não existe (serviço
// fora do ar) pode prender threads por 5 s esperando o DNS. Com dois serviços fora, o pool
// esgotava e até a chamada a um serviço de pé estourava o timeout (medido no /ready, #44).
// O c-ares é assíncrono, não usa esse pool e tem timeout próprio, então um serviço fora
// do ar não atrasa os outros. Só IPv4, porque as redes do Compose e do cluster não usam IPv6.
const resolver = new Resolver({ timeout: 1000, tries: 2 });

type CallbackLookup = (erro: NodeJS.ErrnoException | null, endereco: string | LookupAddress[], familia?: number) => void;

function lookupIPv4(hostname: string, opcoes: { all?: boolean }, callback: CallbackLookup) {
  const literal = isIP(hostname) ? [hostname] : null;
  (literal ? Promise.resolve(literal) : resolver.resolve4(hostname)).then(
    (enderecos) => {
      if (opcoes.all) callback(null, enderecos.map((address) => ({ address, family: 4 })));
      else callback(null, enderecos[0], 4);
    },
    (erro) => callback(erro, ""),
  );
}

// O undici repassa as opções de connect ao net.connect, que aceita lookup; o tipo exige
// campos (port, host) que o undici preenche sozinho por conexão.
const agente = new Agent({ connect: { lookup: lookupIPv4 } as unknown as Agent.Options["connect"] });

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
