import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { devAuth } from "../compartilhado/dev-auth";

const raizDoRepo = fileURLToPath(new URL("../..", import.meta.url));
// O gateway (Kong) publica a porta 8000. O proxy deixa o app no mesmo origin, sem CORS.
const gateway = process.env.AMPARA_GATEWAY ?? "http://localhost:8000";
// No mobile o login é real, a não ser com VITE_AUTH_REAL=false (plugin de login simulado).
const loginSimulado = process.env.VITE_AUTH_REAL === "false";

export default defineConfig({
  plugins: [react(), ...(loginSimulado ? [devAuth(raizDoRepo)] : [])],
  // A tela de login só oferece "qualquer senha" quando o plugin está atendendo.
  define: { "import.meta.env.VITE_LOGIN_SIMULADO": JSON.stringify(loginSimulado) },
  resolve: { alias: { "@c": fileURLToPath(new URL("../compartilhado", import.meta.url)) } },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/auth/v1": { target: gateway, changeOrigin: true },
      "/web/v1": { target: gateway, changeOrigin: true },
      "/mobile/v1": { target: gateway, changeOrigin: true },
    },
  },
});
