// Grava o vídeo do caminho feliz dos dois BFFs: o App Web (ONG) à esquerda, o App Mobile
// (adotante) à direita, painéis de código entre as telas e uma legenda por cena, para os
// integrantes narrarem por cima. Roteiro e falas: docs/apresentacao/parte-4/roteiro-video.md.
//
//   cd scripts/video && npm install && npm run instalar     # uma vez
//   AMPARA_GATEWAY=http://localhost:8000 npm run gravar     # cada gravação
//
// Antes: o sistema no ar (compose ou kind), o seed rodado e os dois apps em modo dev:
//   cd apps && AMPARA_GATEWAY=... VITE_AUTH_REAL=true npm run dev:web
//   cd apps && AMPARA_GATEWAY=... npm run dev:mobile
//
// O tempo de cada cena vem do roteiro: o tamanho da fala dela a ~2,3 palavras por segundo,
// mais uma folga. Os trechos de código são lidos do repositório na hora, achados por uma
// linha-âncora (CODIGOS, abaixo). Cada gravação cria um animal e uma adotante novos, então
// pode ser repetida sem mexer nos dados da demo. Saída em scripts/video/saida/: o vídeo, os
// marcadores (início de cada cena) e as falas de cada integrante com esses tempos (falas.mjs).
//
// Opções (variáveis de ambiente):
//   RITMO=1.8        cenas mais longas (padrão 1.5, a base das durações do roteiro)
//   ANIMAL=Amora     nome do animal cadastrado no vídeo (padrão Pipoca)
//   LEGENDA=nao      grava sem a faixa de legenda
//   MOSTRAR=sim      abre o navegador na tela durante a gravação (para ensaiar)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gerarFalas } from "./falas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const SAIDA = path.join(AQUI, "saida");
const ROTEIRO = path.join(RAIZ, "docs/apresentacao/parte-4/roteiro-video.md");
const DIAGRAMA = path.join(RAIZ, "docs/assets/arquitetura.svg");
const GATEWAY = process.env.AMPARA_GATEWAY ?? "http://localhost:8000";
const WEB = process.env.AMPARA_WEB ?? "http://localhost:5173";
const MOBILE = process.env.AMPARA_MOBILE ?? "http://localhost:5174";
const RITMO = Number(process.env.RITMO ?? 1.5);
const ESCALA = RITMO / 1.5;
const ANIMAL = process.env.ANIMAL ?? "Pipoca";
const COM_LEGENDA = process.env.LEGENDA !== "nao";
const PORTA_PALCO = 5199;
const PALAVRAS_POR_SEGUNDO = 2.3;
const FOTO =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Brown-white_mixed-breed_puppy_2.JPG/960px-Brown-white_mixed-breed_puppy_2.JPG";

// Trechos de código de cada cena: o arquivo, uma ou mais partes (a linha-âncora onde a parte
// começa e quantas linhas mostrar; entre as partes aparece um "⋮") e o que destacar (linhas
// que contêm um destes textos). Até ~30 linhas no total: a fonte encolhe para caber.
const CODIGOS = {
  "1b": { arquivo: "gateway/kong.template.yml",
    partes: [{ ancora: "  - name: bff-web", linhas: 14 }, { ancora: "  - name: bff-mobile", linhas: 13 }],
    destaque: ["paths:", "name: jwt", "minute:"] },
  "1c": { arquivo: "bff/web/src/auth.ts", ancora: "export function exigirRoles(", linhas: 22,
    destaque: ["permitidas.includes", "403", "semPermissao ="] },
  "2b": { arquivo: "services/animais/app/repositorio/animais.py", ancora: "    evento_outbox = montar_evento_outbox(", linhas: 13,
    destaque: ['tipo="animal.criado"', "start_transaction", "insert_one"] },
  "3b": { arquivo: "services/animais/app/projetor.py",
    partes: [{ ancora: "def aproximar(", linhas: 11 }, { ancora: "        await leitura.animais_busca.update_one(", linhas: 10 }],
    destaque: ["round(round", '"$lt"', "except DuplicateKeyError"] },
  "3c": { arquivo: "bff/mobile/src/rotas.ts", ancora: "const card = {", linhas: 22,
    destaque: ["additionalProperties: false", "distanciaKm"] },
  "5b": { arquivo: "services/orquestrador/internal/saga/maquina.go",
    partes: [{ ancora: "\tcase s.Estado == Solicitada && ev.Tipo == EvAnimalReservado:", linhas: 9 },
      { ancora: "\tcase s.Estado == AnimalReservado && ev.Tipo == EvPerfilValidado:", linhas: 11 }],
    destaque: ["// 2.", "// 5.", "Estado = AnimalReservado", "Estado = AguardandoAprovacao", "validarPerfil(", "adocao.aguardando_aprovacao"] },
  "6b": { arquivo: "services/adocao/internal/httpapi/solicitacoes.go", ancora: "// Links segue a tabela do contrato", linhas: 21,
    destaque: ["AguardandoAprovacao && v.Decisao", '"aprovar"', '"recusar"', '"cancelar"'] },
  "7b": { arquivo: "services/notificacoes/app/caixa.py", ancora: '_GRAVAR = """', linhas: 26,
    destaque: ["EXISTS", "return 0", "ZADD", "'SET', marca"] },
  "8b": { arquivo: "services/assistente/app/rag.py", ancora: "def verificar_citacoes(", linhas: 24,
    destaque: ["SEM_COBERTURA", "CitacaoInvalida", "inexistentes"] },
  "8d": { arquivo: "services/assistente/app/recomendacao.py", ancora: "def criar_tool(", linhas: 13,
    destaque: ["@tool", "Literal[", "await busca("] },
};

// ---------- roteiro: título, quem narra e duração de cada cena ----------

function lerRoteiro() {
  const texto = fs.readFileSync(ROTEIRO, "utf8");
  const corpo = texto.split("\n## 3. Roteiro")[1]?.split("\n## 4. ")[0];
  if (!corpo) throw new Error(`não achei a seção "3. Roteiro" em ${ROTEIRO}`);
  const cenas = {};
  for (const bloco of corpo.split("\n### ").slice(1)) {
    const titulo = bloco.split("\n")[0];
    const m = titulo.match(/^(\d+[a-z]?)\.\s+(.*?)\s+·\s+\*(.+?)\*/);
    if (!m) continue;
    const fala = bloco
      .split("\n")
      .filter((l) => l.startsWith(">"))
      .join(" ")
      .match(/"([^"]+)"/g)?.join(" ") ?? "";
    const palavras = fala.split(/\s+/).filter(Boolean).length;
    cenas[m[1]] = { titulo: m[2], quem: m[3], segundos: palavras / PALAVRAS_POR_SEGUNDO + 1.5 };
  }
  return cenas;
}

// ---------- código: trecho do repositório em HTML, com cores simples ----------

const escapar = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PALAVRAS_CHAVE =
  /\b(async|await|def|return|if|else|elif|for|in|not|and|or|with|try|except|pass|import|from|const|let|function|export|type|interface|func|case|switch|map|nil|true|false|True|False|None|local|then|end|while|break|raise|class)\b/g;

function colorir(linha, ext) {
  const marcaComentario = ext === ".py" || ext === ".yml" ? "#" : "//";
  let codigo = linha;
  let comentario = "";
  const i = linha.indexOf(marcaComentario);
  // comentário só fora de string (aproximação suficiente para os trechos escolhidos)
  if (i >= 0 && (linha.slice(0, i).match(/["'`]/g) ?? []).length % 2 === 0) {
    codigo = linha.slice(0, i);
    comentario = linha.slice(i);
  }
  const partes = codigo.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
  const html = partes
    .map((p, j) =>
      j % 2 === 1
        ? `<span class="s">${escapar(p)}</span>`
        : escapar(p).replace(PALAVRAS_CHAVE, '<span class="k">$1</span>'),
    )
    .join("");
  return html + (comentario ? `<span class="c">${escapar(comentario)}</span>` : "");
}

function trecho(id) {
  const c = CODIGOS[id];
  const linhas = fs.readFileSync(path.join(RAIZ, c.arquivo), "utf8").split("\n");
  const ext = path.extname(c.arquivo);
  const partes = c.partes ?? [{ ancora: c.ancora, linhas: c.linhas }];
  const blocos = partes.map(({ ancora, linhas: quantas }) => {
    const inicio = linhas.findIndex((l) => l.startsWith(ancora));
    if (inicio < 0) throw new Error(`cena ${id}: a âncora "${ancora.trim()}" sumiu de ${c.arquivo}; ajuste CODIGOS`);
    return linhas
      .slice(inicio, inicio + quantas)
      .map((l, k) => {
        const forte = c.destaque.some((d) => l.includes(d));
        const visivel = l.replace(/\t/g, "    ");
        return `<div class="l${forte ? " d" : ""}"><i>${inicio + k + 1}</i>${colorir(visivel, ext) || " "}</div>`;
      })
      .join("");
  });
  const total = partes.reduce((n, parte) => n + parte.linhas, 0) + partes.length - 1;
  // ~770 px úteis no painel; 19,5 px é o tamanho confortável, 16 px o mínimo legível
  const fonte = Math.max(16, Math.min(19.5, 770 / (total * 1.42)));
  return { arquivo: c.arquivo, html: blocos.join('<div class="l sep"><i></i>⋮</div>'), fonte };
}

// ---------- .env e API (preparação, fora do vídeo) ----------

function lerEnv() {
  const env = {};
  for (const linha of fs.readFileSync(path.join(RAIZ, ".env"), "utf8").split("\n")) {
    if (!linha || linha.startsWith("#") || !linha.includes("=")) continue;
    const i = linha.indexOf("=");
    let valor = linha.slice(i + 1);
    if (valor.startsWith('"')) valor = JSON.parse(valor);
    env[linha.slice(0, i)] = valor;
  }
  return env;
}

async function api(metodo, caminho, { token, corpo } = {}) {
  const r = await fetch(GATEWAY + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho} -> ${r.status}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

async function conferirAmbiente() {
  for (const [nome, url] of [["gateway", GATEWAY + "/mobile/v1/health"], ["App Web", WEB], ["App Mobile", MOBILE]]) {
    try {
      const r = await fetch(url);
      if (r.status >= 500) throw new Error(String(r.status));
    } catch (erro) {
      throw new Error(`${nome} não respondeu em ${url} (${erro.message}). Veja o cabeçalho de scripts/video/gravar.mjs.`);
    }
  }
}

async function criarAdotante(senha) {
  const email = `ana.${Date.now().toString(36)}@ampara.dev`;
  await api("POST", "/auth/v1/contas", {
    corpo: { nome: "Ana Souza", email, senha, cidade: "Lavras", tipo: "ADOTANTE" },
  });
  const { accessToken } = await api("POST", "/auth/v1/sessoes", { corpo: { email, senha } });
  await api("PUT", "/mobile/v1/eu/perfil-adocao", {
    token: accessToken,
    corpo: { tipoMoradia: "CASA", temQuintal: true, outrosAnimais: false, horasForaDeCasa: 6, aceiteTermo: true },
  });
  return email;
}

// ---------- palco ----------

const PALCO = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Ampara</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #1e1b2e;
         font-family: "Bricolage Grotesque", "Onest", system-ui, sans-serif; color: #fff9f1; }
  header { height: 64px; display: flex; align-items: center; gap: 16px; padding: 0 32px; }
  header b { font-size: 26px; letter-spacing: -0.5px; }
  header b i { color: #ff6a3d; font-style: normal; }
  .chip { padding: 6px 14px; border-radius: 999px; border: 2px solid #4a4560; color: #b9b3cc;
          font: 600 15px ui-monospace, "JetBrains Mono", monospace; transition: all .3s; }
  .chip.ativo { background: #ff6a3d; border-color: #ff6a3d; color: #1e1b2e; }
  main { display: flex; gap: 36px; padding: 0 32px; height: 872px; align-items: flex-start; }
  .web { width: 1360px; height: 860px; border-radius: 14px; overflow: hidden; border: 3px solid #4a4560;
         background: #fff9f1; transition: border-color .3s; }
  .web iframe { width: 1360px; height: 860px; border: 0; }
  .cel { width: 420px; height: 860px; border-radius: 46px; background: #0f0d18; padding: 14px;
         border: 3px solid #4a4560; transition: border-color .3s; }
  .cel iframe { width: 386px; height: 826px; border: 0; border-radius: 34px; background: #fff9f1; }
  .ativo-borda { border-color: #ff6a3d !important; }
  footer { position: absolute; left: 32px; right: 32px; bottom: 22px; min-height: 108px; display: flex;
           gap: 22px; align-items: center; padding: 14px 26px; border-radius: 16px; background: #fff9f1;
           color: #1e1b2e; border: 3px solid #1e1b2e; box-shadow: 6px 6px 0 #ff6a3d; z-index: 4; }
  footer.oculto { display: none; }
  footer .n { font: 800 40px "Bricolage Grotesque", system-ui; color: #ff6a3d; min-width: 72px; text-align: center; }
  footer h2 { margin: 0 0 4px; font-size: 27px; }
  footer p { margin: 0; font-size: 20px; color: #4a4560; }
  footer .quem { margin-left: auto; font: 600 17px ui-monospace, monospace; color: #4a4560; white-space: nowrap; }
  .sobre { position: absolute; left: 32px; right: 32px; top: 64px; height: 860px; border-radius: 16px;
           z-index: 3; opacity: 0; pointer-events: none; transition: opacity .45s; }
  .sobre.visivel { opacity: 1; }
  #codigo { background: #15131f; border: 3px solid #ff6a3d; padding: 26px 34px; overflow: hidden; }
  #codigo .arq { font: 600 21px ui-monospace, "JetBrains Mono", monospace; color: #ffc145; margin-bottom: 14px; }
  #codigo pre { margin: 0; font: 400 19.5px/1.42 ui-monospace, "JetBrains Mono", "DejaVu Sans Mono", monospace; color: #e8e3f5; }
  #codigo .l { white-space: pre; padding-left: 10px; border-left: 5px solid transparent; }
  #codigo .l i { display: inline-block; width: 52px; color: #5f587a; font-style: normal; text-align: right; margin-right: 22px; }
  #codigo .l.d { background: rgba(255,106,61,.17); border-left-color: #ff6a3d; }
  #codigo .l.sep { color: #5f587a; }
  #codigo .k { color: #ff8f6b; } #codigo .s { color: #8fd6a8; } #codigo .c { color: #7d7696; font-style: italic; }
  #diagrama { background: #fff9f1; display: grid; place-items: center; padding: 24px; }
  #diagrama img { width: 100%; height: 100%; object-fit: contain; }
  .capa { position: absolute; inset: 0; display: grid; place-items: center; background: #ff6a3d;
          color: #1e1b2e; text-align: center; transition: opacity .6s; z-index: 6; }
  .capa h1 { font-size: 92px; margin: 0; letter-spacing: -2px; }
  .capa p { font-size: 32px; margin: 12px 0 0; }
  .capa.oculta { opacity: 0; pointer-events: none; }
</style></head><body>
<div class="capa" id="capa"><div><h1 id="capa-t">ampara</h1><p id="capa-s"></p></div></div>
<header><b>amp<i>a</i>ra</b>
  <span class="chip" id="chip-web">App Web → Kong /web/v1 → BFF Web</span>
  <span class="chip" id="chip-mobile">App Mobile → Kong /mobile/v1 → BFF Mobile</span></header>
<main>
  <div class="web" id="moldura-web"><iframe id="web" src="${WEB}/entrar"></iframe></div>
  <div class="cel" id="moldura-mobile"><iframe id="mobile" src="${MOBILE}/entrar"></iframe></div>
</main>
<div class="sobre" id="codigo"><div class="arq" id="codigo-arq"></div><pre id="codigo-pre"></pre></div>
<div class="sobre" id="diagrama"><img src="/arquitetura.svg" alt="Arquitetura"></div>
<footer id="legenda" class="oculto"><div class="n" id="leg-n"></div><div><h2 id="leg-t"></h2><p id="leg-s"></p></div><div class="quem" id="leg-q"></div></footer>
<script>
  window.legenda = (n, titulo, texto, lado, quem) => {
    const f = document.getElementById("legenda");
    f.classList.toggle("oculto", !n);
    document.getElementById("leg-n").textContent = n || "";
    document.getElementById("leg-t").textContent = titulo || "";
    document.getElementById("leg-s").textContent = texto || "";
    document.getElementById("leg-q").textContent = quem ? "narra: " + quem : "";
    for (const l of ["web", "mobile"]) {
      const ativo = lado === l || lado === "ambos";
      document.getElementById("chip-" + l).classList.toggle("ativo", ativo);
      document.getElementById("moldura-" + l).classList.toggle("ativo-borda", ativo);
    }
  };
  window.codigo = (arquivo, html, fonte) => {
    const c = document.getElementById("codigo");
    if (arquivo) {
      document.getElementById("codigo-arq").textContent = arquivo;
      const pre = document.getElementById("codigo-pre");
      pre.innerHTML = html;
      pre.style.fontSize = fonte + "px";
    }
    c.classList.toggle("visivel", !!arquivo);
  };
  window.diagrama = (v) => document.getElementById("diagrama").classList.toggle("visivel", v);
  window.capa = (titulo, sub) => {
    const c = document.getElementById("capa");
    c.classList.toggle("oculta", !titulo);
    if (titulo) { document.getElementById("capa-t").textContent = titulo; document.getElementById("capa-s").textContent = sub || ""; }
  };
</script></body></html>`;

// ---------- utilidades de cena ----------

const espera = (p, s) => p.waitForTimeout(s * 1000 * RITMO);

async function destacar(alvo) {
  await alvo.scrollIntoViewIfNeeded();
  await alvo.evaluate((el) => {
    el.style.transition = "outline .2s";
    el.style.outline = "4px solid #ff6a3d";
    el.style.outlineOffset = "3px";
  });
  await new Promise((r) => setTimeout(r, 650 * RITMO));
  await alvo.evaluate((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  });
}

async function clicar(alvo) {
  await destacar(alvo);
  await alvo.click();
}

async function digitar(alvo, texto) {
  await alvo.scrollIntoViewIfNeeded();
  await alvo.click();
  await alvo.fill("");
  await alvo.pressSequentially(String(texto), { delay: 35 * RITMO });
}

async function rolar(frame, y) {
  await frame.locator("body").evaluate((_, dy) => window.scrollBy({ top: dy, behavior: "smooth" }), y);
}

// ---------- gravação ----------

async function main() {
  const env = lerEnv();
  const senha = env.SEED_SENHA_DEMO;
  if (!senha) throw new Error("SEED_SENHA_DEMO vazia no .env");
  const roteiro = lerRoteiro();
  for (const id of Object.keys(CODIGOS)) trecho(id); // falha cedo se uma âncora sumiu
  await conferirAmbiente();

  console.log("preparando: adotante novo com perfil completo…");
  const emailAdotante = await criarAdotante(senha);

  fs.mkdirSync(SAIDA, { recursive: true });
  const svg = fs.readFileSync(DIAGRAMA);
  const palco = http
    .createServer((q, r) => {
      if (q.url === "/arquitetura.svg") {
        r.writeHead(200, { "Content-Type": "image/svg+xml" });
        return r.end(svg);
      }
      r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      r.end(PALCO);
    })
    .listen(PORTA_PALCO);

  const navegador = await chromium.launch({ headless: process.env.MOSTRAR !== "sim" });
  const contexto = await navegador.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: SAIDA, size: { width: 1920, height: 1080 } },
  });
  const p = await contexto.newPage();
  const inicio = Date.now();
  const marcadores = [];

  // cena(id): segura a cena anterior até o tempo da fala dela, troca a legenda e marca o início
  let atual = null;
  let inicioCena = Date.now();
  const fecharCena = async () => {
    if (!atual) return;
    const falta = (roteiro[atual]?.segundos ?? 6) * ESCALA * 1000 - (Date.now() - inicioCena);
    if (falta > 0) await p.waitForTimeout(falta);
  };
  const cena = async (id, legenda, lado) => {
    await fecharCena();
    const r = roteiro[id];
    if (!r) console.warn(`cena ${id} não está no roteiro: usando 6 s`);
    atual = id;
    inicioCena = Date.now();
    marcadores.push({ t: (Date.now() - inicio) / 1000, id, titulo: r?.titulo ?? id, quem: r?.quem ?? "" });
    const titulo = r?.titulo ?? id;
    await p.evaluate(([n, t, s, l, q]) => window.legenda(n, t, s, l, q),
      COM_LEGENDA ? [id, titulo, legenda, lado, r?.quem] : [null, "", "", lado, ""]);
  };
  const cenaCodigo = async (id, legenda) => {
    const t = trecho(id);
    await cena(id, legenda ?? t.arquivo, "nenhum");
    await p.evaluate(([a, h, f]) => window.codigo(a, h, f), [t.arquivo, t.html, t.fonte]);
    await fecharCena();
    atual = null;
    await p.evaluate(() => window.codigo(null));
  };

  await p.goto(`http://localhost:${PORTA_PALCO}/`);
  const web = p.frameLocator("#web");
  const mob = p.frameLocator("#mobile");
  await p.evaluate(() => window.capa("ampara", "Adoção responsável · dois clientes, dois BFFs"));
  await web.locator("h2").first().waitFor();
  await mob.locator("h1").first().waitFor();

  // 0. abertura e arquitetura
  await cena("0a", "Um animal, do cadastro à adoção, por dois clientes diferentes.", "ambos");
  await espera(p, 4);
  await p.evaluate(() => window.capa(null));
  await cena("0b", "Componentes: dois BFFs atrás do Kong, serviços com banco próprio e eventos no RabbitMQ.", "nenhum");
  await p.evaluate(() => window.diagrama(true));
  await fecharCena();
  atual = null;
  await p.evaluate(() => window.diagrama(false));

  // 1. a ONG entra no painel
  await cena("1a", "Login real na Identidade: o token RS256 vai em toda chamada ao /web/v1.", "web");
  await digitar(web.locator("input[type=email]"), "ong@ampara.dev");
  await digitar(web.locator("input[type=password]"), senha);
  await clicar(web.getByRole("button", { name: "Entrar", exact: true }));
  await web.getByRole("heading", { level: 1 }).filter({ hasText: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 20000 });
  await cenaCodigo("1b");
  await cenaCodigo("1c");

  // 2. cadastro do animal e a ficha completa
  await cena("2a", `O BFF Web grava a ${ANIMAL} no serviço de Animais.`, "web");
  await clicar(web.getByRole("link", { name: "Cadastrar animal" }));
  const f = web.locator("form");
  await digitar(f.locator("input[name=nome]"), ANIMAL);
  await f.locator("select[name=especie]").selectOption("CAO");
  await f.locator("select[name=sexo]").selectOption("FEMEA");
  await f.locator("select[name=porte]").selectOption("PEQUENO");
  await digitar(f.locator("input[name=idadeMeses]"), 5);
  await digitar(f.locator("input[name=temperamento]"), "brincalhona, dócil");
  await digitar(f.locator("textarea[name=descricao]"), "Filhote resgatada, vacinada e muito carinhosa.");
  await f.locator("textarea[name=fotos]").fill(FOTO);
  await digitar(f.locator("input[name=rua]"), "Rua Doutor Francisco Sales");
  await digitar(f.locator("input[name=numero]"), "100");
  await digitar(f.locator("input[name=bairro]"), "Centro");
  await f.locator("input[name=cidade]").fill("Lavras");
  await f.locator("input[name=uf]").fill("MG");
  await f.locator("input[name=cep]").fill("37200-000");
  await f.locator("input[name=lat]").fill("-21.2452");
  await f.locator("input[name=lng]").fill("-44.9997");
  await clicar(f.getByRole("button", { name: "Cadastrar" }));
  await web.getByRole("heading", { level: 1, name: ANIMAL }).waitFor({ timeout: 20000 });
  await cenaCodigo("2b");
  await cena("2c", "No painel: rua, número, CEP e histórico de status. O celular não recebe nada disso.", "web");
  await espera(p, 3);
  await rolar(web, 350);

  // 3. a adotante busca por raio
  await cena("3a", "Outro cliente, outra rota: o App Mobile fala só com o /mobile/v1.", "mobile");
  await digitar(mob.locator("input[type=email]"), emailAdotante);
  await digitar(mob.locator("input[type=password]"), senha);
  await clicar(mob.getByRole("button", { name: "Entrar", exact: true }));
  await mob.getByRole("heading", { level: 1 }).first().waitFor();
  const cartao = mob.getByRole("link").filter({ has: mob.getByRole("heading", { name: ANIMAL, exact: true }) }).first();
  for (let i = 0; i < 20 && !(await cartao.isVisible()); i++) {
    await mob.getByRole("link", { name: "Buscar" }).click();
    await espera(p, 1);
  }
  await espera(p, 1);
  await destacar(cartao);
  await cenaCodigo("3b");
  await cenaCodigo("3c");

  // 4. a ficha no celular e o pedido
  await cena("4a", "Só bairro, cidade e distância: o BFF Mobile corta rua, número e coordenada.", "ambos");
  await clicar(cartao);
  await mob.getByRole("heading", { level: 1, name: ANIMAL }).waitFor();
  await espera(p, 4);
  await rolar(mob, 400);
  await espera(p, 4);
  await clicar(mob.getByRole("button", { name: `Quero adotar ${ANIMAL}` }));

  // 5. a SAGA
  await cena("5a", "Reserva do animal, validação do perfil e espera pela ONG: cada passo é um carimbo.", "mobile");
  await mob.getByText("Aguardando aprovação").first().waitFor({ timeout: 45000 });
  await espera(p, 3);
  await rolar(mob, 400);
  await cenaCodigo("5b");

  // 6. a ONG decide
  await cena("6a", "A ONG vê o perfil de adoção de quem pediu.", "web");
  await clicar(web.getByRole("link", { name: "Solicitações", exact: true }));
  const pedido = web.getByRole("link").filter({ hasText: ANIMAL }).filter({ hasText: "Ana Souza" }).first();
  await pedido.waitFor({ timeout: 30000 });
  await espera(p, 1);
  await clicar(pedido);
  await web.getByRole("button", { name: "Aprovar adoção" }).waitFor({ timeout: 20000 });
  await espera(p, 2);
  await rolar(web, 450);
  await cenaCodigo("6b");
  await cena("6c", "A SAGA confirma a adoção e conclui o pedido.", "web");
  await clicar(web.getByRole("button", { name: "Aprovar adoção" }));
  await web.getByText("Adoção concluída").first().waitFor({ timeout: 45000 });

  // 7. avisos
  await cena("7a", "O pedido muda sozinho, e os avisos de cada etapa chegam ao celular.", "mobile");
  await mob.getByText("Adoção concluída").first().waitFor({ timeout: 30000 });
  await rolar(mob, -800);
  await espera(p, 3);
  await clicar(mob.getByRole("link", { name: /^Avisos/ }));
  await mob.getByText(/Adoção concluída|Adoção aprovada/).first().waitFor({ timeout: 30000 });
  await cenaCodigo("7b");

  // 8. Assistente
  await cena("8a", "RAG: a resposta cita trechos da base de conhecimento da Ampara.", "mobile");
  await clicar(mob.getByRole("link", { name: "Assistente" }));
  await clicar(mob.getByRole("button", { name: "Dá para ter cachorro em apartamento?" }));
  await mob.getByText(/Fontes/).first().waitFor({ timeout: 40000 }).catch(() => {});
  await cenaCodigo("8b");
  await cena("8c", "O agente chama a ferramenta de busca e explica cada sugestão.", "mobile");
  await clicar(mob.getByRole("button", { name: "Quem combina comigo" }));
  await digitar(mob.locator("textarea[required]"), "Moro em apartamento pequeno e trabalho 8 horas fora de casa.");
  await clicar(mob.getByRole("button", { name: "Recomendar animais" }));
  await mob.getByRole("button", { name: "Recomendar animais" }).waitFor({ timeout: 40000 });
  await espera(p, 2);
  await rolar(mob, 450);
  await espera(p, 3);
  await rolar(mob, 450);
  await cenaCodigo("8d");

  // 9. encerramento
  await cena("9", "", "ambos");
  await p.evaluate(() => window.legenda(null, "", "", "ambos", ""));
  await p.evaluate(() => window.capa("ampara", "Um animal, dois clientes, dois BFFs, uma SAGA."));
  await fecharCena();
  const duracao = (Date.now() - inicio) / 1000;

  const video = p.video();
  await contexto.close();
  await navegador.close();
  palco.close();

  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const webm = path.join(SAIDA, `ampara-caminho-feliz-${carimbo}.webm`);
  fs.renameSync(await video.path(), webm);
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium",
      "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  } catch {
    console.warn("ffmpeg não encontrado: ficou só o .webm (abre em qualquer navegador e editor de vídeo).");
  }
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const linhas = marcadores.map((m) => `${mmss(m.t)}  ${m.id.padEnd(3)} ${m.titulo}  (narra: ${m.quem})`);
  linhas.push(`${mmss(duracao)}  fim`);
  const arquivoMarcadores = path.join(SAIDA, `marcadores-${carimbo}.txt`);
  fs.writeFileSync(arquivoMarcadores, linhas.join("\n") + "\n");
  // as falas de cada integrante com os tempos desta gravação
  const falas = gerarFalas(arquivoMarcadores, path.join(SAIDA, `falas-${carimbo}.md`));
  console.log(`\nvídeo: ${fs.existsSync(mp4) ? mp4 : webm}\nfalas por integrante: ${falas}\nmarcadores:\n${linhas.join("\n")}`);
}

main().catch((erro) => {
  console.error(`\nfalhou: ${erro.message}`);
  process.exit(1);
});
