import { criarApp } from "./app.js";
import { criarVerificador } from "./auth.js";
import { criarCliente } from "./cliente.js";
import { carregarConfig } from "./config.js";

const config = carregarConfig();
const app = criarApp({
  config,
  verificar: await criarVerificador(config.jwtPublicKey),
  chamar: criarCliente(config.timeoutMs),
});

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    app.log.info({ sinal }, "encerrando");
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: "0.0.0.0", port: config.porta });
