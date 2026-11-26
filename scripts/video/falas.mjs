// Gera o documento de falas por integrante, sincronizado com uma gravação: junta as falas
// do roteiro (docs/apresentacao/parte-4/roteiro-video.md) com os tempos reais do arquivo de
// marcadores que o gravar.mjs escreve.
//
//   node falas.mjs saida/marcadores-<data>.txt                 # escreve saida/falas-<data>.md
//   node falas.mjs saida/marcadores-<data>.txt destino.md      # escreve em outro lugar
//
// O gravar.mjs chama gerarFalas() sozinho ao fim de cada gravação.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
export const ROTEIRO = path.join(RAIZ, "docs/apresentacao/parte-4/roteiro-video.md");
const ORDEM = ["Mateus", "Gabriel Soares", "Gabriel Cantanhede", "Gabriel Nakazato"];
const NOMES = {
  Mateus: "Mateus Vitor",
  "Gabriel Soares": "Gabriel Soares",
  "Gabriel Cantanhede": "Gabriel Cantanhede",
  "Gabriel Nakazato": "Gabriel Nakazato",
};

/** Cenas do roteiro, na ordem: id, título, quem narra, o que aparece e a fala. */
export function lerCenas(roteiro = ROTEIRO) {
  const corpo = fs.readFileSync(roteiro, "utf8").split("\n## 3. Roteiro")[1]?.split("\n## 4. ")[0];
  if (!corpo) throw new Error(`não achei a seção "3. Roteiro" em ${roteiro}`);
  const cenas = [];
  for (const bloco of corpo.split("\n### ").slice(1)) {
    const linhas = bloco.split("\n");
    const m = linhas[0].match(/^(\d+[a-z]?)\.\s+(.*?)\s+·\s+\*(.+?)\*/);
    if (!m) continue;
    const tela = (linhas.find((l) => l.startsWith("**Na tela:**")) ?? "").replace("**Na tela:**", "").trim();
    const fala = (linhas.filter((l) => l.startsWith(">")).join(" ").match(/"([^"]+)"/g) ?? [])
      .map((f) => f.slice(1, -1))
      .join(" ");
    cenas.push({ id: m[1], titulo: m[2], quem: m[3], tela, fala });
  }
  return cenas;
}

/** Tempos do arquivo de marcadores: { id: segundos de início } e o fim do vídeo. */
function lerMarcadores(arquivo) {
  const tempos = {};
  let fim = null;
  for (const linha of fs.readFileSync(arquivo, "utf8").split("\n")) {
    const m = linha.match(/^(\d+):(\d+)\s+(\S+)/);
    if (!m) continue;
    const s = Number(m[1]) * 60 + Number(m[2]);
    if (m[3] === "fim") fim = s;
    else tempos[m[3]] = s;
  }
  return { tempos, fim };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function deixa(anterior) {
  if (!anterior) return "início do vídeo, quando a capa laranja aparece.";
  const palavras = anterior.fala.split(/\s+/);
  const final = palavras.slice(-6).join(" ");
  return `depois de ${NOMES[anterior.quem] ?? anterior.quem} terminar com "…${final}"`;
}

export function gerarFalas(arquivoMarcadores, destino) {
  const cenas = lerCenas();
  const { tempos, fim } = lerMarcadores(arquivoMarcadores);
  const faltando = cenas.filter((c) => tempos[c.id] === undefined).map((c) => c.id);
  if (faltando.length) throw new Error(`cenas sem tempo nos marcadores: ${faltando.join(", ")}`);
  const ordenadas = [...cenas].sort((a, b) => tempos[a.id] - tempos[b.id]);
  ordenadas.forEach((c, i) => {
    c.inicio = tempos[c.id];
    c.fim = i + 1 < ordenadas.length ? tempos[ordenadas[i + 1].id] : fim ?? c.inicio + 10;
    c.anterior = ordenadas[i - 1];
  });
  const video = path.basename(arquivoMarcadores).replace(/^marcadores-/, "ampara-caminho-feliz-").replace(/\.txt$/, ".mp4");
  const total = fim ?? ordenadas.at(-1).fim;

  const out = [];
  out.push("# Falas por integrante, sincronizadas com o vídeo");
  out.push("");
  out.push(`Gerado a partir de \`docs/apresentacao/parte-4/roteiro-video.md\` e dos tempos da gravação \`${video}\` (${mmss(total)} de vídeo). Para outra gravação, rode \`node scripts/video/falas.mjs scripts/video/saida/marcadores-<data>.txt\`: os tempos mudam alguns segundos de uma gravação para outra.`);
  out.push("");
  out.push("**Como usar:** cada um lê só a sua seção. A coluna **Entra** é o minuto do vídeo em que a cena começa (a legenda na tela mostra o número da cena e \"narra: seu nome\"). A **deixa** são as últimas palavras de quem fala antes. Comece a falar quando a legenda trocar e termine antes do minuto em **Até**.");
  out.push("");
  out.push("## Ordem de entrada");
  out.push("");
  out.push("| Entra | Até | Cena | Quem narra |");
  out.push("| --- | --- | --- | --- |");
  for (const c of ordenadas) out.push(`| ${mmss(c.inicio)} | ${mmss(c.fim)} | **${c.id}** · ${c.titulo} | ${NOMES[c.quem] ?? c.quem} |`);
  out.push("");
  out.push("| Integrante | Cenas | Tempo de fala |");
  out.push("| --- | --- | --- |");
  for (const quem of ORDEM) {
    const minhas = ordenadas.filter((c) => c.quem === quem);
    const tempo = minhas.reduce((s, c) => s + (c.fim - c.inicio), 0);
    out.push(`| ${NOMES[quem]} | ${minhas.map((c) => c.id).join(", ")} | ${mmss(tempo)} |`);
  }

  for (const quem of ORDEM) {
    const minhas = ordenadas.filter((c) => c.quem === quem);
    if (!minhas.length) continue;
    out.push("");
    out.push(`## ${NOMES[quem]}`);
    for (const c of minhas) {
      const palavras = c.fala.split(/\s+/).length;
      out.push("");
      out.push(`### ${mmss(c.inicio)} a ${mmss(c.fim)} · cena ${c.id} · ${c.titulo}`);
      out.push("");
      out.push(`- **Deixa:** ${deixa(c.anterior)}`);
      out.push(`- **Na tela:** ${c.tela}`);
      out.push(`- **Tamanho:** ${palavras} palavras, cerca de ${Math.round(palavras / 2.3)} s de fala em ${c.fim - c.inicio} s de cena.`);
      out.push("");
      out.push(`> ${c.fala}`);
    }
  }
  out.push("");
  fs.writeFileSync(destino, out.join("\n"));
  return destino;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [marcadores, destino] = process.argv.slice(2);
  if (!marcadores) {
    console.error("uso: node falas.mjs saida/marcadores-<data>.txt [destino.md]");
    process.exit(2);
  }
  const saida = destino ?? marcadores.replace(/marcadores-([^/]+)\.txt$/, "falas-$1.md");
  console.log(`falas: ${gerarFalas(marcadores, saida)}`);
}
