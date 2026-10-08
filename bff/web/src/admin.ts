import type { FastifyInstance } from "fastify";
import { exigirRoles, type Verificador } from "./auth.js";
import type { Cliente } from "./cliente.js";
import type { Config } from "./config.js";
import { essencial } from "./servicos.js";

// Verificação de contas (#61): só ADMIN, e a Identidade é o único serviço envolvido.

interface ContaResumo {
  id: string;
  nome: string;
  role: string;
  cidade: string;
  statusVerificacao: string;
}

// O BFF devolve só os campos do contrato, mesmo que a Identidade mande mais.
const resumo = ({ id, nome, role, cidade, statusVerificacao }: ContaResumo) => ({ id, nome, role, cidade, statusVerificacao });

interface Dependencias {
  config: Config;
  verificar: Verificador;
  chamar: Cliente;
}

export function rotasDeAdmin(r: FastifyInstance, { config, verificar, chamar }: Dependencias) {
  const soAdmin = exigirRoles(verificar, ["ADMIN"], "A verificação de contas é exclusiva de administradores.");
  const contas = `${config.servicos.identidade}/v1/contas`;

  r.get<{ Querystring: { statusVerificacao: string; role?: string } }>(
    "/admin/contas",
    {
      onRequest: soAdmin,
      schema: {
        querystring: {
          type: "object",
          properties: {
            statusVerificacao: { type: "string", enum: ["PENDENTE_VERIFICACAO", "VERIFICADA"], default: "PENDENTE_VERIFICACAO" },
            role: { type: "string", enum: ["PROTETOR", "ONG"] },
          },
        },
      },
    },
    async (req) => {
      const filtros = new URLSearchParams({ statusVerificacao: req.query.statusVerificacao });
      if (req.query.role) filtros.set("role", req.query.role);
      const lista = await essencial<ContaResumo[]>(chamar, "identidade", `${contas}?${filtros}`, req);
      return lista.map(resumo);
    },
  );

  r.put<{ Params: { id: string }; Body: { status: "VERIFICADA" } }>(
    "/admin/contas/:id/verificacao",
    {
      onRequest: soAdmin,
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
        body: {
          type: "object",
          required: ["status"],
          additionalProperties: false,
          properties: { status: { type: "string", enum: ["VERIFICADA"] } },
        },
      },
    },
    async (req) => {
      const conta = await essencial<ContaResumo>(chamar, "identidade", `${contas}/${req.params.id}/verificacao`, req, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      return resumo(conta);
    },
  );
}
