// GIF animado do caminho feliz para o README (o "wireframe" em vídeo): só as cenas de tela
// da gravação, sem os painéis de código, a abertura e o encerramento, aceleradas e sem a faixa
// de legenda.
//
//   node gif.mjs                       # usa a gravação mais recente de saida/
//   node gif.mjs --video saida/ampara-caminho-feliz-<data>.mp4 --destino ../../docs/assets/x.gif
//
// As cenas de tela são as do roteiro cujo título não começa com "Código" (fora 0a, 0b e 9).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerCenas } from "./falas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "saida");
const VELOCIDADE = 4;
const FORA = new Set(["0a", "0b", "9"]);

const argumento = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });

function maisRecente() {
  const v = fs.readdirSync(SAIDA).filter((a) => /^ampara-caminho-feliz-.*\d\.mp4$/.test(a));
  v.sort((a, b) => fs.statSync(path.join(SAIDA, b)).mtimeMs - fs.statSync(path.join(SAIDA, a)).mtimeMs);
  if (!v[0]) throw new Error("não achei a gravação das telas em saida/; rode antes o gravar.mjs");
  return path.join(SAIDA, v[0]);
}

const video = argumento("video", maisRecente());
const destino = argumento("destino", path.resolve(AQUI, "../../docs/assets/wireframe-caminho-feliz.gif"));
const tempos = {};
let fim = null;
for (const linha of fs.readFileSync(video.replace("ampara-caminho-feliz-", "marcadores-").replace(/\.mp4$/, ".txt"), "utf8").split("\n")) {
  const m = linha.match(/^(\d+):(\d+)\s+(\S+)/);
  if (m && m[3] === "fim") fim = Number(m[1]) * 60 + Number(m[2]);
  else if (m) tempos[m[3]] = Number(m[1]) * 60 + Number(m[2]);
}
const cenas = lerCenas();
const ordem = cenas.map((c) => c.id);
const telas = cenas.filter((c) => !FORA.has(c.id) && !c.titulo.startsWith("Código"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ampara-gif-"));
const lista = [];
for (const [i, c] of telas.entries()) {
  const proxima = ordem[ordem.indexOf(c.id) + 1];
  const inicio = tempos[c.id];
  const fimCena = proxima ? tempos[proxima] : fim;
  const seg = path.join(tmp, `s${i}.mp4`);
  // corta a faixa de legenda (fica o cabeçalho e os dois apps), acelera e reduz
  ffmpeg(["-ss", String(inicio), "-t", String(fimCena - inicio), "-i", video, "-an", "-vf",
    `crop=1920:856:0:0,setpts=PTS/${VELOCIDADE},fps=8,scale=960:-2:flags=lanczos`, seg]);
  lista.push(`file '${seg}'`);
}
fs.writeFileSync(path.join(tmp, "lista.txt"), lista.join("\n"));
const todos = path.join(tmp, "todos.mp4");
ffmpeg(["-f", "concat", "-safe", "0", "-i", path.join(tmp, "lista.txt"), "-c", "copy", todos]);
const paleta = path.join(tmp, "paleta.png");
ffmpeg(["-i", todos, "-vf", "palettegen=max_colors=128:stats_mode=diff", paleta]);
ffmpeg(["-i", todos, "-i", paleta, "-lavfi", "paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", destino]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`gif: ${destino} (${(fs.statSync(destino).size / 1e6).toFixed(1)} MB, cenas ${telas.map((c) => c.id).join(", ")})`);
