// Documentos de falas a partir do roteiro (docs/apresentacao/parte-4/roteiro-video.md):
//
//   node falas.mjs saida/marcadores-<data>.txt [destino.md]
//       falas de cada parte com os minutos de uma gravação (o gravar.mjs gera sozinho)
//   node falas.mjs para-gravar [destino.md] [link da pasta de envio]
//       o documento para o grupo gravar: como gravar, como mandar e o texto de cada parte
//
// As partes são os trechos seguidos do roteiro narrados pela mesma pessoa: cada integrante
// grava um vídeo só com a parte dele, e o montar.mjs encaixa cada vídeo na sua parte.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
export const ROTEIRO = path.join(RAIZ, "docs/apresentacao/parte-4/roteiro-video.md");
export const NOMES = {
  Mateus: "Mateus Vitor",
  "Gabriel Soares": "Gabriel Soares",
  "Gabriel Cantanhede": "Gabriel Cantanhede",
  "Gabriel Nakazato": "Gabriel Nakazato",
};
const PALAVRAS_POR_SEGUNDO = 2.3;
const nome = (quem) => NOMES[quem] ?? quem;
const slug = (texto) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "-");

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
    cenas.push({ id: m[1], titulo: m[2], quem: m[3], tela, fala, palavras: fala.split(/\s+/).filter(Boolean).length });
  }
  return cenas;
}

/** Partes: os trechos seguidos de cenas com o mesmo narrador, numeradas a partir de 1. */
export function lerPartes(cenas = lerCenas()) {
  const partes = [];
  for (const c of cenas) {
    const ultima = partes.at(-1);
    if (ultima && ultima.quem === c.quem) ultima.cenas.push(c);
    else partes.push({ n: partes.length + 1, quem: c.quem, nome: nome(c.quem), slug: slug(nome(c.quem)), cenas: [c] });
  }
  return partes;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const segundosDeFala = (cenas) => cenas.reduce((s, c) => s + c.palavras / PALAVRAS_POR_SEGUNDO, 0);

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

/** Falas de cada parte com os minutos de uma gravação das telas. */
export function gerarFalas(arquivoMarcadores, destino) {
  const cenas = lerCenas();
  const partes = lerPartes(cenas);
  const { tempos, fim } = lerMarcadores(arquivoMarcadores);
  const faltando = cenas.filter((c) => tempos[c.id] === undefined).map((c) => c.id);
  if (faltando.length) throw new Error(`cenas sem tempo nos marcadores: ${faltando.join(", ")}`);
  cenas.forEach((c, i) => {
    c.inicio = tempos[c.id];
    c.fim = i + 1 < cenas.length ? tempos[cenas[i + 1].id] : fim ?? c.inicio + 10;
  });
  const video = path.basename(arquivoMarcadores).replace(/^marcadores-/, "ampara-caminho-feliz-").replace(/\.txt$/, ".mp4");
  const o = [];
  o.push("# Falas por parte, sincronizadas com o vídeo das telas");
  o.push("");
  o.push(`Gerado a partir de \`docs/apresentacao/parte-4/roteiro-video.md\` e dos tempos da gravação \`${video}\` (${mmss(fim ?? cenas.at(-1).fim)} de vídeo). Para outra gravação: \`node scripts/video/falas.mjs scripts/video/saida/marcadores-<data>.txt\`. Para gravar as falas, use [\`falas-para-gravar.md\`](falas-para-gravar.md).`);
  o.push("");
  o.push("| Parte | Quem narra | Cenas | Do minuto | Até | Fala |");
  o.push("| --- | --- | --- | --- | --- | --- |");
  for (const p of partes) {
    o.push(`| ${p.n} | ${p.nome} | ${p.cenas[0].id} a ${p.cenas.at(-1).id} | ${mmss(p.cenas[0].inicio)} | ${mmss(p.cenas.at(-1).fim)} | ~${mmss(segundosDeFala(p.cenas))} |`);
  }
  for (const p of partes) {
    o.push("");
    o.push(`## Parte ${p.n} · ${p.nome}`);
    for (const c of p.cenas) {
      o.push("");
      o.push(`### ${mmss(c.inicio)} a ${mmss(c.fim)} · cena ${c.id} · ${c.titulo}`);
      o.push("");
      o.push(`- **Na tela:** ${c.tela}`);
      o.push(`- **Tamanho:** ${c.palavras} palavras, cerca de ${Math.round(c.palavras / PALAVRAS_POR_SEGUNDO)} s de fala em ${c.fim - c.inicio} s de cena.`);
      o.push("");
      o.push(`> ${c.fala}`);
    }
  }
  o.push("");
  fs.writeFileSync(destino, o.join("\n"));
  return destino;
}

/** O documento para o grupo: como gravar, como mandar e o texto de cada parte. */
export function gerarParaGravar(destino, pasta) {
  const partes = lerPartes();
  const total = partes.reduce((s, p) => s + segundosDeFala(p.cenas), 0);
  const o = [];
  o.push("# Ampara · falas para gravar o vídeo da Parte 4");
  o.push("");
  o.push(`O vídeo tem cerca de ${Math.round(total / 60) + 1} minutos e segue um animal do cadastro até a adoção, passando pelos dois BFFs. As telas já estão gravadas. Falta **o rosto e a voz de cada um**. O vídeo é dividido em **quatro partes seguidas**, uma por integrante, e **cada um grava um vídeo só, no celular, com a parte inteira dele**. A montagem junta tudo: o seu rosto aparece num círculo no canto do vídeo, e a sua voz vira a narração da sua parte.`);
  o.push("");
  o.push("## As quatro partes");
  o.push("");
  for (const p of partes) {
    o.push(`- **Parte ${p.n} · ${p.nome}:** cenas ${p.cenas[0].id} a ${p.cenas.at(-1).id}, cerca de ${mmss(segundosDeFala(p.cenas))} de fala. Arquivo: \`${p.n}-${p.slug}.mp4\`.`);
  }
  o.push("");
  o.push("## Como gravar");
  o.push("");
  o.push("1. **Celular em pé, câmera da frente**, na altura dos olhos (apoiado em livros ou num suporte).");
  o.push("2. **Rosto no centro**, com um pouco de espaço acima da cabeça: o vídeo recorta um círculo do meio da imagem.");
  o.push("3. **Lugar silencioso e luz de frente** (de frente para a janela, nunca de costas para ela).");
  o.push("4. **Um vídeo só, com a sua parte inteira:** aperte gravar, espere 2 segundos e leia as cenas na ordem, com **uma pausa curta (1 segundo) entre uma cena e outra**. No fim, espere 2 segundos e pare.");
  o.push("5. **Ritmo calmo e constante.** As telas da sua parte acompanham a sua velocidade média, então evite pausas longas no meio. O tempo indicado é uma referência.");
  o.push("6. **Pode ler.** Deixe este documento aberto no computador, atrás do celular, ou use um app de teleprompter.");
  o.push("7. **Errou no meio?** Pare a gravação, corte o trecho errado do fim com o editor da galeria do celular e **comece um vídeo novo a partir do começo da cena em que errou**, com o número dessa cena no nome (por exemplo, `6b.mp4`). A montagem emenda os dois vídeos na ordem certa.");
  o.push("");
  o.push("## Como mandar");
  o.push("");
  o.push("- **Nome do arquivo:** o número da sua parte, se quiser com o seu nome: `1-gabriel-soares.mp4`, `2-gabriel-cantanhede.mp4`, `3-mateus-vitor.mp4`, `4-gabriel-nakazato.mp4`.");
  if (pasta) o.push(`- **Envie para a pasta do Drive:** ${pasta} (se não tiver acesso, peça ao Mateus).`);
  o.push("- Pelo WhatsApp também serve, mas **envie como documento**, não como vídeo: como vídeo, o WhatsApp diminui a qualidade.");
  for (const p of partes) {
    o.push("");
    o.push(`## Parte ${p.n} · ${p.nome}`);
    o.push("");
    o.push(`**Arquivo:** \`${p.n}-${p.slug}.mp4\` · **cerca de ${mmss(segundosDeFala(p.cenas))} de fala** · ${p.cenas.length} cenas, lidas em sequência`);
    for (const c of p.cenas) {
      o.push("");
      o.push(`### Cena ${c.id} · ${c.titulo} (~${Math.round(c.palavras / PALAVRAS_POR_SEGUNDO)} s)`);
      o.push("");
      o.push(`**No vídeo, enquanto você fala:** ${c.tela.replace(/`/g, "")}`);
      o.push("");
      o.push(`> ${c.fala}`);
    }
  }
  o.push("");
  fs.writeFileSync(destino, o.join("\n"));
  return destino;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [primeiro, segundo, terceiro] = process.argv.slice(2);
  if (primeiro === "para-gravar") {
    const destino = segundo ?? path.join(RAIZ, "docs/apresentacao/parte-4/falas-para-gravar.md");
    console.log(`para gravar: ${gerarParaGravar(destino, terceiro)}`);
  } else if (primeiro) {
    const destino = segundo ?? primeiro.replace(/marcadores-([^/]+)\.txt$/, "falas-$1.md");
    console.log(`falas: ${gerarFalas(primeiro, destino)}`);
  } else {
    console.error("uso: node falas.mjs saida/marcadores-<data>.txt [destino.md]\n     node falas.mjs para-gravar [destino.md] [link da pasta]");
    process.exit(2);
  }
}
