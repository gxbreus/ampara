import Fastify, { LogController, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { exigirRoles, type Verificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { problema } from "./problema.js";

interface Dependencias {
  config: Config;
  verificar: Verificador;
  chamar: Cliente;
  logger?: boolean;
}

export function criarApp({ config, verificar, chamar, logger = true }: Dependencias): FastifyInstance {
  const app = Fastify({
    logger: logger ? { level: process.env.LOG_LEVEL ?? "info" } : false,
    // o X-Correlation-Id vira o id da requisição e aparece em todo log como correlationId
    genReqId: (req) => {
      const recebido = req.headers["x-correlation-id"];
      return typeof recebido === "string" && recebido !== "" ? recebido : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: "correlationId" }),
  });

  const servidoPor = os.hostname();
  app.addHook("onSend", (req, reply, payload, done) => {
    reply.header("X-Served-By", servidoPor);
    reply.header("X-Correlation-Id", req.id);
    done(null, payload);
  });

  const rolesDoPainel = exigirRoles(verificar, ["PROTETOR", "ONG", "ADMIN"]);

  // O gateway encaminha /web/v1/* sem cortar o prefixo, então todas as rotas ficam sob ele.
  app.register(
    (r, _opcoes, done) => {
      r.get("/health", (_req, reply) => reply.send({ status: "ok" }));

      r.get("/ready", async (req, reply) => {
        const nomes = Object.keys(config.servicos) as (keyof Config["servicos"])[];
        const resultados = await Promise.all(
          nomes.map(async (nome) => {
            try {
              const resp = await chamar(`${config.servicos[nome]}/health`, req);
              return [nome, resp.ok ? "ok" : "indisponivel"] as const;
            } catch {
              return [nome, "indisponivel"] as const;
            }
          }),
        );
        const dependencias = Object.fromEntries(resultados);
        const pronto = resultados.every(([, estado]) => estado === "ok");
        return reply.code(pronto ? 200 : 503).send({ status: pronto ? "pronto" : "indisponivel", dependencias });
      });

      // Conta autenticada: repassa para a Identidade (GET /v1/contas/eu), como no contrato.
      r.get("/eu", { preHandler: rolesDoPainel }, async (req, reply) => {
        let resp: Response;
        try {
          resp = await chamar(`${config.servicos.identidade}/v1/contas/eu`, req);
        } catch {
          return problema(reply, 503, "servico-indisponivel", "Serviço indisponível", "Identidade não respondeu.");
        }
        const corpo = await resp.text();
        return reply.code(resp.status).type(resp.headers.get("content-type") ?? "application/json").send(corpo);
      });
      done();
    },
    { prefix: "/web/v1" },
  );

  return app;
}
