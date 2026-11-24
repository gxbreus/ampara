import type { FastifyRequest } from "fastify";
import { Agent } from "undici";

// Sem keep-alive nas chamadas internas: cada chamada abre uma conexão nova.
// O Service do Kubernetes balanceia por conexão, não por requisição. Com o pool keep-alive
// padrão do fetch, cada pod do BFF ficava preso a uma conexão com um único pod do Animais,
// e uma réplica nova não recebia tráfego nenhum. O custo é um handshake TCP dentro do cluster.
const semKeepAlive = new Agent({ pipelining: 0 });

export function criarCliente(timeoutMs: number) {
  return async (url: string, req: FastifyRequest, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("X-Correlation-Id", req.id);
    if (req.headers.authorization) headers.set("Authorization", req.headers.authorization);
    // dispatcher é extensão do fetch do Node (undici); o tipo RequestInit aceita a chave extra
    const opcoes = { ...init, headers, signal: init.signal ?? AbortSignal.timeout(timeoutMs), dispatcher: semKeepAlive };
    const response = await fetch(url, opcoes);
    // Consome também o corpo dentro do prazo; o fetch sozinho só espera os headers.
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  };
}
export type Cliente = ReturnType<typeof criarCliente>;
