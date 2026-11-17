import type { FastifyRequest } from "fastify";

export function criarCliente(timeoutMs: number) {
  return async (url: string, req: FastifyRequest, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("X-Correlation-Id", req.id);
    if (req.headers.authorization) headers.set("Authorization", req.headers.authorization);
    const response = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    // Consome também o corpo dentro do prazo; o fetch sozinho só espera os headers.
    const body = await response.arrayBuffer();
    return new Response(body.byteLength ? body : null, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  };
}
export type Cliente = ReturnType<typeof criarCliente>;
