#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(import.meta.dirname, "..");
const catalogo = readFileSync(resolve(raiz, "docs/contratos/eventos.md"), "utf8");
const diretorioPadrao = resolve(raiz, "docs/contratos/mensagens");
const args = new Set(process.argv.slice(2));
const indice = process.argv.indexOf("--examples-dir");
const diretorioExemplos = indice === -1 ? null : resolve(process.argv[indice + 1] ?? "");

if (indice !== -1 && !process.argv[indice + 1]) {
  throw new Error("--examples-dir exige um diretório");
}

function arquivosDoCatalogo() {
  const secoes = [...catalogo.matchAll(/^#### `([^`]+)`[\s\S]*?<details><summary>Schema do payload e exemplo<\/summary>\s*```json\s*([\s\S]*?)\s*```\s*```json\s*([\s\S]*?)\s*```/gm)];
  if (secoes.length !== 30) {
    throw new Error(`esperados 30 schemas no catálogo, encontrados ${secoes.length}`);
  }

  return secoes.map(([, nome, schema, exemplo]) => {
    const arquivo = `${nome}.schema.json`;
    return {
      arquivo,
      schema: `${JSON.stringify(JSON.parse(schema), null, 2)}\n`,
      exemplo: `${JSON.stringify(JSON.parse(exemplo), null, 2)}\n`,
    };
  });
}

const mensagens = arquivosDoCatalogo();

if (args.has("--check")) {
  const existentes = readdirSync(diretorioPadrao).filter((arquivo) => arquivo.endsWith(".schema.json")).sort();
  const esperados = mensagens.map(({ arquivo }) => arquivo).sort();
  if (JSON.stringify(existentes) !== JSON.stringify(esperados)) {
    throw new Error("os arquivos em docs/contratos/mensagens divergem do catálogo; execute npm run contratos:extrair");
  }
  for (const { arquivo, schema } of mensagens) {
    if (readFileSync(resolve(diretorioPadrao, arquivo), "utf8") !== schema) {
      throw new Error(`${arquivo} diverge de docs/contratos/eventos.md; execute npm run contratos:extrair`);
    }
  }
} else {
  rmSync(diretorioPadrao, { recursive: true, force: true });
  mkdirSync(diretorioPadrao, { recursive: true });
  for (const { arquivo, schema } of mensagens) writeFileSync(resolve(diretorioPadrao, arquivo), schema);
}

if (diretorioExemplos) {
  rmSync(diretorioExemplos, { recursive: true, force: true });
  mkdirSync(diretorioExemplos, { recursive: true });
  for (const { arquivo, exemplo } of mensagens) writeFileSync(resolve(diretorioExemplos, arquivo), exemplo);
}
