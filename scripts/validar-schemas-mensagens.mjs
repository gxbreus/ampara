#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "../bff/web/node_modules/ajv/dist/2020.js";
import addFormats from "../bff/web/node_modules/ajv-formats/dist/index.js";

const raiz = resolve(import.meta.dirname, "..");
const schemas = resolve(raiz, "docs/contratos/mensagens");
const exemplos = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("informe o diretório com os exemplos extraídos");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const arquivo of readdirSync(schemas).filter((nome) => nome.endsWith(".schema.json")).sort()) {
  const schema = JSON.parse(readFileSync(resolve(schemas, arquivo), "utf8"));
  const exemplo = JSON.parse(readFileSync(resolve(exemplos, arquivo), "utf8"));
  const validar = ajv.compile(schema);
  if (!validar(exemplo)) {
    throw new Error(`${arquivo}: exemplo inválido: ${ajv.errorsText(validar.errors)}`);
  }
  console.log(`${arquivo}: schema e exemplo válidos`);
}
