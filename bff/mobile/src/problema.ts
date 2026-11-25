import type { FastifyReply } from "fastify";

// Erros em application/problem+json, como nos contratos (docs/contratos/bff-web.v1.yaml).
export function problema(reply: FastifyReply, status: number, tipo: string, titulo: string, detalhe: string) {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: `https://ampara.dev/problemas/${tipo}`, title: titulo, status, detail: detalhe });
}
