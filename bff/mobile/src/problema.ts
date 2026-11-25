import type { FastifyReply } from "fastify";

// Erros em application/problem+json, como nos contratos (docs/contratos/bff-web.v1.yaml).
export function problema(reply: FastifyReply, status: number, tipo: string, _titulo: string, detalhe: string) {
  return reply
    .code(status)
    .type("application/json")
    .send({ codigo: tipo, mensagem: detalhe });
}
