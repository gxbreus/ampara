// Login de desenvolvimento enquanto a Identidade não tem as rotas de autenticação (#149).
//
// Só roda no `vite dev` (configureServer). Atende POST /auth/v1/sessoes e /auth/v1/contas
// no próprio servidor do Vite e assina um JWT RS256 com a JWT_PRIVATE_KEY do .env da raiz,
// a mesma chave que a Identidade vai usar. Por isso o Kong e os BFFs aceitam o token e as
// rotas que já existem respondem de verdade. Com VITE_AUTH_REAL=true o plugin sai do
// caminho e o proxy manda /auth/v1 para o gateway.
import { createPrivateKey, createSign, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";

type Role = "ADOTANTE" | "PROTETOR" | "ONG" | "ADMIN";

interface ContaDev {
  id: string;
  nome: string;
  email: string;
  role: Role;
  cidade: string;
  statusVerificacao: "PENDENTE_VERIFICACAO" | "VERIFICADA";
}

// As ONGs e a protetora usam os mesmos ids do seed de Animais (scripts/seed/seed_animais.py),
// para o painel enxergar os animais e as solicitações reais de cada uma.
export const CONTAS_DEV: ContaDev[] = [
  { id: "00000000-0000-4000-8000-0000000000a1", nome: "ONG Patinhas de Lavras", email: "ong@ampara.dev", role: "ONG", cidade: "Lavras", statusVerificacao: "VERIFICADA" },
  { id: "00000000-0000-4000-8000-0000000000a2", nome: "Abrigo Amigo Fiel", email: "ong2@ampara.dev", role: "ONG", cidade: "Perdões", statusVerificacao: "VERIFICADA" },
  { id: "00000000-0000-4000-8000-0000000000b1", nome: "Rita Protetora", email: "protetor@ampara.dev", role: "PROTETOR", cidade: "Lavras", statusVerificacao: "VERIFICADA" },
  { id: "00000000-0000-4000-8000-0000000000c1", nome: "Admin Ampara", email: "admin@ampara.dev", role: "ADMIN", cidade: "Lavras", statusVerificacao: "VERIFICADA" },
  { id: "00000000-0000-4000-8000-0000000000d1", nome: "Bruna Silva", email: "adotante@ampara.dev", role: "ADOTANTE", cidade: "Lavras", statusVerificacao: "VERIFICADA" },
];

function lerChavePrivada(raiz: string): string | null {
  if (process.env.JWT_PRIVATE_KEY) return process.env.JWT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const arquivo = resolve(raiz, ".env");
  if (!existsSync(arquivo)) return null;
  const linha = readFileSync(arquivo, "utf8").split("\n").find((l) => l.startsWith("JWT_PRIVATE_KEY="));
  if (!linha) return null;
  const valor = linha.slice("JWT_PRIVATE_KEY=".length).replace(/^"|"$/g, "").replace(/\\n/g, "\n");
  return valor.includes("PRIVATE KEY") ? valor : null;
}

const b64url = (dados: string | Buffer) => Buffer.from(dados).toString("base64url");

function assinar(chave: string, conta: ContaDev) {
  const agora = Math.floor(Date.now() / 1000);
  const exp = agora + 8 * 3600;
  const claims = { iss: "ampara-identidade", sub: conta.id, role: conta.role, iat: agora, exp };
  const corpo = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const assinatura = createSign("RSA-SHA256").update(corpo).sign(createPrivateKey(chave));
  return { accessToken: `${corpo}.${b64url(assinatura)}`, tokenType: "Bearer", expiraEm: new Date(exp * 1000).toISOString(), claims };
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok) => {
    let texto = "";
    req.on("data", (parte) => (texto += parte));
    req.on("end", () => {
      try {
        ok(JSON.parse(texto || "{}"));
      } catch {
        ok({});
      }
    });
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown, tipo = "application/json") {
  res.statusCode = status;
  res.setHeader("Content-Type", tipo);
  res.end(JSON.stringify(corpo));
}

const problema = (status: number, title: string, detail: string) => ({
  type: `https://ampara.dev/problemas/${title.toLowerCase().replace(/\s+/g, "-")}`,
  title,
  status,
  detail,
});

export function devAuth(raizDoRepo: string): Plugin {
  const extras: ContaDev[] = [];
  return {
    name: "ampara-dev-auth",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITE_AUTH_REAL === "true") return;
      const chave = lerChavePrivada(raizDoRepo);
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || !req.url?.startsWith("/auth/v1/")) return next();
        if (!chave) {
          return responder(res, 503, problema(503, "Sem chave JWT", "Rode ./scripts/gerar-chaves-jwt.sh para criar a JWT_PRIVATE_KEY no .env."), "application/problem+json");
        }
        const corpo = await lerCorpo(req);
        const email = String(corpo.email ?? "").trim().toLowerCase();
        const todas = [...CONTAS_DEV, ...extras];

        if (req.url.startsWith("/auth/v1/sessoes")) {
          const conta = todas.find((c) => c.email === email);
          if (!conta || String(corpo.senha ?? "").length < 1) {
            return responder(res, 401, problema(401, "Credenciais inválidas", "E-mail ou senha inválidos."), "application/problem+json");
          }
          return responder(res, 200, { ...assinar(chave, conta), conta });
        }

        if (req.url.startsWith("/auth/v1/contas")) {
          if (todas.some((c) => c.email === email)) {
            return responder(res, 409, problema(409, "E-mail já cadastrado", "Já existe uma conta com este e-mail."), "application/problem+json");
          }
          const tipo = String(corpo.tipo ?? "ADOTANTE") as Role;
          const conta: ContaDev = {
            id: randomUUID(),
            nome: String(corpo.nome ?? ""),
            email,
            role: tipo,
            cidade: String(corpo.cidade ?? ""),
            statusVerificacao: tipo === "ADOTANTE" ? "VERIFICADA" : "PENDENTE_VERIFICACAO",
          };
          extras.push(conta);
          res.setHeader("Location", `/v1/contas/${conta.id}`);
          return responder(res, 201, conta);
        }
        next();
      });
    },
  };
}
