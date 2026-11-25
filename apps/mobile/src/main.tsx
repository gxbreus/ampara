import "@fontsource-variable/fraunces";
import "@fontsource-variable/instrument-sans";
import "@c/base.css";
import "./estilo.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SessaoProvider } from "@c/sessao";
import { App } from "./App";

const consultas = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <SessaoProvider rolesPermitidas={["ADOTANTE"]}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessaoProvider>
    </QueryClientProvider>
  </StrictMode>,
);
