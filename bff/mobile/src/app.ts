import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { exigirRoles, type Verificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { ErroServico, rotas } from "./rotas.js";

export interface Dependencias { config: Config; verificar: Verificador; chamar: Cliente; logger?: boolean }

export function criarApp({ config, verificar, chamar, logger = true }: Dependencias): FastifyInstance {
  const app = Fastify({
    logger,
    genReqId: req => typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : randomUUID(),
    logController: new LogController({ requestIdLogLabel: "correlationId" }),
  });
  app.addHook("onSend", (req, reply, body, done) => {
    reply.header("X-Served-By", hostname()).header("X-Correlation-Id", req.id);
    done(null, body);
  });
  const privado = exigirRoles(verificar, ["ADOTANTE"], "Esta área é exclusiva de adotantes.");
  const health = () => ({ status: "ok" });
  const ready = async (req: FastifyRequest) => {
    const pares = await Promise.all(Object.entries(config.servicos).map(async ([nome, url]) => {
      try { const response = await chamar(`${url}/health`, req); return [nome, response.ok ? "ok" : "indisponivel"]; }
      catch { return [nome, "indisponivel"]; }
    }));
    return Object.fromEntries(pares) as Record<string, string>;
  };
  app.get("/health", health);
  app.get("/ready", async (req, reply) => {
    const dependencias = await ready(req);
    return reply.code(Object.values(dependencias).every(v => v === "ok") ? 200 : 503).send({ dependencias });
  });
  app.get("/mobile/v1/health", { onRequest: privado }, health);
  app.get("/mobile/v1/ready", { onRequest: privado }, async (req, reply) => {
    const dependencias = await ready(req);
    return reply.code(Object.values(dependencias).every(v => v === "ok") ? 200 : 503).send({ dependencias });
  });
  rotas(app, { config, verificar, chamar });
  app.setNotFoundHandler({ preHandler: privado }, (_req, reply) => reply.code(404).send({ codigo: "nao-encontrado", mensagem: "Rota não encontrada." }));
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ErroServico) return reply.code(error.status).send({ codigo: error.codigo, mensagem: error.message });
    // Validação de schema (path, query, header, corpo) é ParametrosInvalidos no contrato: 400.
    if (error instanceof Error && "validation" in error) return reply.code(400).send({ codigo: "parametros-invalidos", mensagem: "Confira os campos enviados." });
    req.log.error(error);
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return reply.code(timeout ? 504 : 502).send({ codigo: timeout ? "servico-lento" : "servico-indisponivel", mensagem: "Serviço temporariamente indisponível. Tente novamente." });
  });
  return app;
}
