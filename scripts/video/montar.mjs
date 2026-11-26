// Monta o vídeo final: a gravação das telas (gravar.mjs) com o rosto e a voz de cada
// integrante, gravados no celular.
//
//   node montar.mjs                                   # usa a gravação mais recente e clipes/
//   node montar.mjs --video saida/ampara-caminho-feliz-<data>.mp4 --clipes ~/Downloads/clipes
//
// Clipes: cada arquivo começa numa cena e vale até o começo do próximo clipe ou até o fim da
// parte de quem fala (as partes estão no roteiro e em falas-para-gravar.md):
//   - pelo número da parte: 1.mp4, 2-gabriel-cantanhede.mov… começa na primeira cena da parte;
//   - pelo número de uma cena: 6b.mp4 começa na cena 6b (para quem errou no meio da parte e
//     recomeçou dali num vídeo novo).
// Qualquer formato do celular serve (mp4, mov, m4v, 3gp, webm), em pé ou deitado: o montador
// recorta um quadrado do centro (aproximando no vídeo deitado) e põe no círculo reservado na
// faixa de legenda.
//
// Tempos das cenas dentro do clipe (opcional): um arquivo com o mesmo nome e extensão .cenas
// (1-gabriel-soares.cenas), uma linha por cena, "<id> <segundo em que a fala da cena começa>":
//   0b 13.0
//   1a 38.0
// Com ele, cada cena acompanha o próprio pedaço da fala; sem ele, a parte toda anda numa
// velocidade só.
//
// Em cada trecho, a velocidade das telas é ajustada para durar o mesmo que a fala (de 0,6× a
// 1,6×; além disso, a tela congela ou a fala termina antes), então a tela acompanha quem fala.
// Trecho sem clipe fica sem som e com as iniciais no círculo. O volume é igualado em cada trecho
// (vozes de celulares diferentes ficam no mesmo nível) e de novo no fim; saem
// o vídeo final e os marcadores com os tempos novos.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerPartes } from "./falas.mjs";
import { CAMERA } from "./gravar.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "saida");
const EXTENSOES = [".mp4", ".mov", ".m4v", ".3gp", ".webm", ".mkv"];
const FOLGA = 0.4; // segundos depois do fim da fala antes de passar ao próximo trecho
const [LENTO, RAPIDO] = [1.6, 0.6]; // limites do ajuste de velocidade das telas

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}

function maisRecente(padrao) {
  const arquivos = fs.existsSync(SAIDA) ? fs.readdirSync(SAIDA).filter((a) => padrao.test(a)) : [];
  arquivos.sort((a, b) => fs.statSync(path.join(SAIDA, b)).mtimeMs - fs.statSync(path.join(SAIDA, a)).mtimeMs);
  return arquivos[0] ? path.join(SAIDA, arquivos[0]) : null;
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const sonda = (args, arquivo) => execFileSync("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0", arquivo]).toString().trim();
const duracao = (arquivo) => Number(sonda(["-show_entries", "format=duration"], arquivo));
const temAudio = (arquivo) => sonda(["-select_streams", "a", "-show_entries", "stream=index"], arquivo).length > 0;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function lerMarcadores(arquivo) {
  const cenas = [];
  let fim = null;
  for (const linha of fs.readFileSync(arquivo, "utf8").split("\n")) {
    const m = linha.match(/^(\d+):(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]);
    if (m[3] === "fim") fim = t;
    else cenas.push({ id: m[3], resto: m[4], inicio: t });
  }
  cenas.forEach((c, i) => (c.fim = i + 1 < cenas.length ? cenas[i + 1].inicio : fim));
  return cenas;
}

/** Clipe que começa em `chave` (número da parte ou da cena), se houver. */
function acharClipe(arquivos, chave) {
  const nome = arquivos.find((a) => new RegExp(`^${chave}([-_ .]|$)`, "i").test(a));
  return nome ?? null;
}

/** Trechos: grupos de cenas seguidas cobertos pelo mesmo clipe (ou sem clipe). */
function montarTrechos(cenas, pastaClipes) {
  const arquivos = fs.existsSync(pastaClipes)
    ? fs.readdirSync(pastaClipes).filter((a) => EXTENSOES.includes(path.extname(a).toLowerCase()))
    : [];
  const parteDe = {};
  for (const p of lerPartes()) for (const c of p.cenas) parteDe[c.id] = p;
  const trechos = [];
  let atual = null;
  for (const c of cenas) {
    const parte = parteDe[c.id];
    const primeiraDaParte = parte && parte.cenas[0].id === c.id;
    const clipe = acharClipe(arquivos, c.id) ?? (primeiraDaParte ? acharClipe(arquivos, String(parte.n)) : null);
    const mudouDeParte = atual && parteDe[atual.cenas[0].id] !== parte;
    if (!atual || clipe || mudouDeParte) {
      atual = { cenas: [], clipe: clipe ? path.join(pastaClipes, clipe) : null };
      trechos.push(atual);
    }
    atual.cenas.push(c);
  }
  return trechos.flatMap(dividirPorCenas);
}

function lerTemposDoClipe(clipe) {
  const arquivo = clipe.replace(/\.[^.]+$/, ".cenas");
  if (!fs.existsSync(arquivo)) return {};
  const tempos = {};
  for (const linha of fs.readFileSync(arquivo, "utf8").split("\n")) {
    const m = linha.trim().match(/^(\S+)\s+([\d.]+)/);
    if (m) tempos[m[1]] = Number(m[2]);
  }
  return tempos;
}

/** Quebra um trecho com clipe nas cenas que têm tempo no .cenas do clipe. */
function dividirPorCenas(t) {
  if (!t.clipe) return [t];
  const tempos = lerTemposDoClipe(t.clipe);
  const total = duracao(t.clipe);
  const pedacos = [];
  for (const c of t.cenas) {
    const marca = tempos[c.id];
    if (!pedacos.length || marca != null) pedacos.push({ cenas: [], clipe: t.clipe, de: pedacos.length ? marca : 0 });
    pedacos.at(-1).cenas.push(c);
  }
  pedacos.forEach((p, i) => {
    p.ate = i + 1 < pedacos.length ? pedacos[i + 1].de : total;
    p.ultimo = i + 1 === pedacos.length;
  });
  return pedacos;
}

function main() {
  const video = argumento("video", maisRecente(/^ampara-caminho-feliz-.*\d\.mp4$/));
  if (!video) throw new Error("não achei a gravação das telas; rode antes o gravar.mjs ou use --video");
  const marcadores = argumento("marcadores", video.replace(/ampara-caminho-feliz-/, "marcadores-").replace(/\.mp4$/, ".txt"));
  const pastaClipes = argumento("clipes", path.join(AQUI, "clipes"));
  const cenas = lerMarcadores(marcadores);
  const total = duracao(video);
  if (cenas.at(-1).fim == null || cenas.at(-1).fim > total) cenas.at(-1).fim = total;
  const trechos = montarTrechos(cenas, pastaClipes);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ampara-montagem-"));
  const D = CAMERA.diametro;
  const segmentos = [];
  const novos = [];
  let relogio = 0;
  console.log(`montando ${path.basename(video)} com os clipes de ${pastaClipes}`);

  for (const [i, t] of trechos.entries()) {
    const inicio = t.cenas[0].inicio;
    const tela = Math.max(0.5, t.cenas.at(-1).fim - inicio);
    const fala = t.clipe ? t.ate - t.de : 0;
    const folga = t.clipe && t.ultimo ? FOLGA : 0;
    // fator de velocidade das telas: >1 deixa a tela mais lenta (fala mais longa que a cena)
    const desejado = t.clipe ? (fala + folga) / tela : 1;
    const fator = Math.min(LENTO, Math.max(RAPIDO, desejado));
    const telaAjustada = tela * fator;
    const L = t.clipe ? Math.max(telaAjustada, fala + folga) : tela;
    const congelar = Math.max(0, L - telaAjustada);
    const seg = path.join(tmp, `seg-${String(i).padStart(2, "0")}.mp4`);
    const fundo =
      `[0:v]trim=duration=${tela.toFixed(3)},setpts=(PTS-STARTPTS)*${fator.toFixed(4)},fps=30,` +
      `tpad=stop_mode=clone:stop_duration=${congelar.toFixed(3)},format=yuv420p`;
    const codecs = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"];
    if (t.clipe) {
      // em pé: quadrado do centro; deitado: aproxima (65% da altura, um pouco acima do meio),
      // porque a câmera deitada pega o rosto pequeno
      const lado = "if(gt(iw,ih),ih*0.65,min(iw,ih))";
      const cam = `[1:v]crop='${lado}':'${lado}':'(iw-ow)/2':'if(gt(iw,ih),ih*0.55-oh/2,(ih-oh)/2)',scale=${D}:${D},fps=30,format=yuva420p,` +
        `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2-1),255,0)'[cam]`;
      const audio = temAudio(t.clipe)
        ? `[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${L.toFixed(3)}[a]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${L.toFixed(3)}[a]`;
      ffmpeg(["-ss", String(inicio), "-t", tela.toFixed(3), "-i", video,
        "-ss", t.de.toFixed(3), "-t", fala.toFixed(3), "-i", t.clipe, "-filter_complex",
        [`${fundo}[fundo]`, cam, `[fundo][cam]overlay=${CAMERA.x}:${CAMERA.y}:eof_action=pass[v]`, audio].join(";"),
        "-map", "[v]", "-map", "[a]", "-t", L.toFixed(3), ...codecs, seg]);
    } else {
      ffmpeg(["-ss", String(inicio), "-t", tela.toFixed(3), "-i", video,
        "-f", "lavfi", "-t", L.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo",
        "-filter_complex", `${fundo}[v]`, "-map", "[v]", "-map", "1:a", "-t", L.toFixed(3), ...codecs, seg]);
    }
    segmentos.push(seg);
    for (const c of t.cenas) {
      novos.push(`${mmss(relogio + (c.inicio - inicio) * fator)}  ${c.id.padEnd(3)} ${c.resto}${t.clipe ? "" : "  [sem clipe]"}`);
    }
    const ids = `${t.cenas[0].id}${t.cenas.length > 1 ? ` a ${t.cenas.at(-1).id}` : ""}`;
    const aviso = desejado > LENTO ? `, fala longa: +${congelar.toFixed(1)} s de tela congelada`
      : desejado < RAPIDO ? ", fala curta: o fim do trecho fica sem voz" : "";
    console.log(`  cenas ${ids.padEnd(9)} ${t.clipe ? `${path.basename(t.clipe)} ${t.de.toFixed(0)}s: ${fala.toFixed(1)} s de fala, telas a ${fator.toFixed(2)}× (${tela.toFixed(0)} s → ${L.toFixed(0)} s)${aviso}` : "sem clipe"}`);
    relogio += L;
  }

  const lista = path.join(tmp, "lista.txt");
  fs.writeFileSync(lista, segmentos.map((s) => `file '${s}'`).join("\n"));
  const juntos = path.join(tmp, "juntos.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", juntos]);
  const carimbo = path.basename(video).replace(/^ampara-caminho-feliz-/, "").replace(/\.mp4$/, "");
  const final = path.join(SAIDA, `ampara-video-final-${carimbo}.mp4`);
  ffmpeg(["-i", juntos, "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", final]);
  novos.push(`${mmss(relogio)}  fim`);
  fs.writeFileSync(path.join(SAIDA, `marcadores-final-${carimbo}.txt`), novos.join("\n") + "\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nvídeo final: ${final} (${mmss(relogio)})`);
}

try {
  main();
} catch (erro) {
  console.error(`\nfalhou: ${erro.message}`);
  process.exit(1);
}
