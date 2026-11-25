import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { devAuth } from "../compartilhado/dev-auth";

const raizDoRepo = fileURLToPath(new URL("../..", import.meta.url));
// O gateway (Kong) publica a porta 8000. O proxy deixa o app no mesmo origin, sem CORS.
const gateway = process.env.AMPARA_GATEWAY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), devAuth(raizDoRepo)],
  resolve: { alias: { "@c": fileURLToPath(new URL("../compartilhado", import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/auth/v1": { target: gateway, changeOrigin: true },
      "/web/v1": { target: gateway, changeOrigin: true },
      "/mobile/v1": { target: gateway, changeOrigin: true },
    },
  },
});
