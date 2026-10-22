import type { FastifyReply, FastifyRequest } from "fastify";
import { importSPKI, jwtVerify, type JWTPayload } from "jose";
import { problema } from "./problema.js";

export type Role = "ADOTANTE" | "PROTETOR" | "ONG" | "ADMIN";

export interface Usuario {
  sub: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    usuario?: Usuario;
  }
}

// O gateway já validou o token, mas o BFF verifica de novo. Se alguém chegar ao BFF por
// dentro da rede, sem passar pelo Kong, o token continua sendo checado: assinatura RS256,
// emissor e expiração. O BFF só conhece a chave PÚBLICA; quem assina é a Identidade.
// Esta é a 2ª das 3 camadas: o Kong confere a assinatura, o BFF confere a role do
// cliente e o serviço decide sobre o recurso.
export async function criarVerificador(chavePublica: string) {
  const chave = await importSPKI(chavePublica, "RS256");

  return async function verificar(token: string): Promise<Usuario> {
    const { payload } = await jwtVerify(token, chave, {
      algorithms: ["RS256"],
      issuer: "ampara-identidade",
    });
    return paraUsuario(payload);
  };
}

function paraUsuario(payload: JWTPayload): Usuario {
  const role = payload.role;
  if (typeof payload.sub !== "string" || typeof role !== "string") {
    throw new Error("token sem sub ou role");
  }
  return { sub: payload.sub, role: role as Role };
}

export type Verificador = Awaited<ReturnType<typeof criarVerificador>>;

// Hook (onRequest) que exige um token válido com uma das roles permitidas.
export function exigirRoles(
  verificar: Verificador,
  permitidas: Role[],
  semPermissao = "O painel web é exclusivo de protetores, ONGs e administradores.",
) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const [esquema, token] = (req.headers.authorization ?? "").split(" ");
    if (esquema !== "Bearer" || !token) {
      return problema(reply, 401, "nao-autenticado", "Não autenticado", "Envie um token Bearer válido.");
    }
    try {
      req.usuario = await verificar(token);
    } catch {
      return problema(reply, 401, "nao-autenticado", "Não autenticado", "Token inválido ou expirado.");
    }
    if (!permitidas.includes(req.usuario.role)) {
      return problema(reply, 403, "sem-permissao", "Sem permissão", semPermissao);
    }
  };
}
