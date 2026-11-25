import { test } from "node:test";
import assert from "node:assert/strict";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { criarVerificador } from "./auth.js";

test("RS256 exige emissor, expiração, sub e assinatura válida", async () => {
  const par = await generateKeyPair("RS256");
  const verificar = await criarVerificador(await exportSPKI(par.publicKey));
  const criar = (iss = "ampara-identidade") => new SignJWT({ role: "ADOTANTE" })
    .setProtectedHeader({ alg: "RS256" }).setSubject("adotante").setIssuer(iss);
  const valido = await criar().setExpirationTime("1h").sign(par.privateKey);
  assert.deepEqual(await verificar(valido), { sub: "adotante", role: "ADOTANTE" });
  await assert.rejects(verificar(await criar().sign(par.privateKey)));
  await assert.rejects(verificar(await criar().setExpirationTime(1).sign(par.privateKey)));
  await assert.rejects(verificar(await criar("outro").setExpirationTime("1h").sign(par.privateKey)));
  const outra = await generateKeyPair("RS256");
  await assert.rejects(verificar(await criar().setExpirationTime("1h").sign(outra.privateKey)));
});
