import { criarApp } from "./app.js";
import { criarVerificador } from "./auth.js";
import { criarCliente } from "./cliente.js";
import { carregarConfig } from "./config.js";
import { consumirEventos, Hub } from "./eventos.js";

const config = carregarConfig();
const hub = config.amqpUrl ? new Hub() : undefined;
const app = criarApp({
  config,
  verificar: await criarVerificador(config.jwtPublicKey),
  chamar: criarCliente(config.timeoutMs),
  hub,
});
const pararEventos = hub && config.amqpUrl ? consumirEventos(config.amqpUrl, hub, app.log) : null;
if (!hub) app.log.warn("BFF_WEB_AMQP_URL não definida: o painel fica sem eventos em tempo real");

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    app.log.info({ sinal }, "encerrando");
    Promise.all([pararEventos?.(), app.close()]).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: "0.0.0.0", port: config.porta });
