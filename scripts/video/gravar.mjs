// Grava o caminho feliz dos dois BFFs num vídeo só, com o App Web (ONG) à esquerda e o
// App Mobile (adotante) à direita, e uma legenda por etapa para a narração por cima.
//
//   cd scripts/video && npm install && npm run instalar     # uma vez
//   AMPARA_GATEWAY=http://localhost:8080 npm run gravar     # cada gravação
//
// Antes: o sistema no ar (compose ou kind), o seed rodado e os dois apps em modo dev:
//   cd apps && AMPARA_GATEWAY=... VITE_AUTH_REAL=true npm run dev:web
//   cd apps && AMPARA_GATEWAY=... npm run dev:mobile
//
// Cada gravação cria um animal novo (cadastrado pela ONG no próprio vídeo) e um adotante novo
// com perfil completo, então pode ser repetida sem mexer nos dados da demo. Saída em
// scripts/video/saida/: o .mp4, o .webm original e marcadores.txt (início de cada etapa).
//
// Opções (variáveis de ambiente):
//   RITMO=2          pausas mais longas (padrão 1.5, cerca de 2min30 de vídeo)
//   ANIMAL=Pipoca    nome do animal cadastrado no vídeo
//   LEGENDA=nao      grava sem a faixa de legenda
//   MOSTRAR=sim      abre o navegador na tela durante a gravação (para ensaiar)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const SAIDA = path.join(AQUI, "saida");
const GATEWAY = process.env.AMPARA_GATEWAY ?? "http://localhost:8000";
const WEB = process.env.AMPARA_WEB ?? "http://localhost:5173";
const MOBILE = process.env.AMPARA_MOBILE ?? "http://localhost:5174";
const RITMO = Number(process.env.RITMO ?? 1.5);
const ANIMAL = process.env.ANIMAL ?? "Pipoca";
const COM_LEGENDA = process.env.LEGENDA !== "nao";
const PORTA_PALCO = 5199;
// Tempo mínimo de cada etapa na tela, em segundos (com RITMO=1.5): o tamanho da fala do
// roteiro (docs/apresentacao/parte-4/roteiro-video.md) a ~2,3 palavras por segundo, com folga.
// Assim os marcadores do vídeo batem com a narração.
const MINIMO = { 0: 11, 1: 19, 2: 31, 3: 23, 4: 19, 5: 18, 6: 23, 7: 22, 8: 36, 9: 7 };
const FOTO =
  "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Brown-white_mixed-breed_puppy_2.JPG/960px-Brown-white_mixed-breed_puppy_2.JPG";

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
  const sufixo = Date.now().toString(36);
  const email = `ana.${sufixo}@ampara.dev`;
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

// ---------- palco: os dois apps lado a lado, com a legenda ----------

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
           color: #1e1b2e; border: 3px solid #1e1b2e; box-shadow: 6px 6px 0 #ff6a3d; }
  footer.oculto { display: none; }
  footer .n { font: 800 44px "Bricolage Grotesque", system-ui; color: #ff6a3d; min-width: 64px; text-align: center; }
  footer h2 { margin: 0 0 4px; font-size: 27px; }
  footer p { margin: 0; font-size: 20px; color: #4a4560; }
  .capa { position: absolute; inset: 0; display: grid; place-items: center; background: #ff6a3d;
          color: #1e1b2e; text-align: center; transition: opacity .6s; z-index: 5; }
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
<footer id="legenda" class="oculto"><div class="n" id="leg-n"></div><div><h2 id="leg-t"></h2><p id="leg-s"></p></div></footer>
<script>
  window.legenda = (n, titulo, texto, lado) => {
    const f = document.getElementById("legenda");
    f.classList.toggle("oculto", !n);
    document.getElementById("leg-n").textContent = n || "";
    document.getElementById("leg-t").textContent = titulo || "";
    document.getElementById("leg-s").textContent = texto || "";
    for (const l of ["web", "mobile"]) {
      const ativo = lado === l || lado === "ambos";
      document.getElementById("chip-" + l).classList.toggle("ativo", ativo);
      document.getElementById("moldura-" + l).classList.toggle("ativo-borda", ativo);
    }
  };
  window.capa = (titulo, sub) => {
    const c = document.getElementById("capa");
    c.classList.toggle("oculta", !titulo);
    if (titulo) { document.getElementById("capa-t").textContent = titulo; document.getElementById("capa-s").textContent = sub || ""; }
  };
</script></body></html>`;

// ---------- utilidades de cena ----------

const pausa = (p, s) => p.waitForTimeout(s * 1000 * RITMO);

async function destacar(alvo) {
  await alvo.scrollIntoViewIfNeeded();
  await alvo.evaluate((el) => {
    el.style.transition = "box-shadow .2s, outline .2s";
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

// ---------- o roteiro gravado ----------

async function main() {
  const env = lerEnv();
  const senha = env.SEED_SENHA_DEMO;
  if (!senha) throw new Error("SEED_SENHA_DEMO vazia no .env");
  await conferirAmbiente();

  console.log("preparando: adotante novo com perfil completo…");
  const emailAdotante = await criarAdotante(senha);

  fs.mkdirSync(SAIDA, { recursive: true });
  const palco = http
    .createServer((_, r) => {
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
  let etapa = 0;
  let inicioEtapa = Date.now();
  // segura a etapa atual na tela até a fala dela caber, antes de passar para a próxima
  const fecharEtapa = async (proxima) => {
    if (proxima === etapa) return;
    const falta = (MINIMO[etapa] ?? 0) * (RITMO / 1.5) * 1000 - (Date.now() - inicioEtapa);
    if (falta > 0) await p.waitForTimeout(falta);
    etapa = proxima;
    inicioEtapa = Date.now();
  };
  const legenda = async (n, titulo, texto, lado) => {
    if (n) await fecharEtapa(n);
    if (n) marcadores.push({ t: (Date.now() - inicio) / 1000, n, titulo });
    if (COM_LEGENDA) await p.evaluate(([a, b, c, d]) => window.legenda(a, b, c, d), [n, titulo, texto, lado]);
    else await p.evaluate(([d]) => window.legenda(null, "", "", d), [lado]);
  };

  await p.goto(`http://localhost:${PORTA_PALCO}/`);
  const web = p.frameLocator("#web");
  const mob = p.frameLocator("#mobile");
  await p.evaluate(() => window.capa("ampara", "Adoção responsável · dois clientes, dois BFFs"));
  await web.locator("h2").first().waitFor();
  await mob.locator("h1").first().waitFor();
  marcadores.push({ t: 0, n: 0, titulo: "Abertura" });
  await pausa(p, 3);
  await p.evaluate(() => window.capa(null));

  // 1. ONG entra no painel (BFF Web)
  await legenda(1, "A ONG entra no painel web", "Login real na Identidade: o token RS256 vai junto em toda chamada ao /web/v1.", "web");
  await pausa(p, 2);
  await digitar(web.locator("input[type=email]"), "ong@ampara.dev");
  await digitar(web.locator("input[type=password]"), senha);
  await clicar(web.getByRole("button", { name: "Entrar", exact: true }));
  await web.getByRole("heading", { level: 1 }).filter({ hasText: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 20000 });
  await pausa(p, 4);

  // 2. ONG cadastra o animal
  await legenda(2, `A ONG cadastra a ${ANIMAL}`, "O BFF Web grava no serviço de Animais com o endereço completo do abrigo.", "web");
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
  await pausa(p, 1);
  await clicar(f.getByRole("button", { name: "Cadastrar" }));
  await web.getByRole("heading", { level: 1, name: ANIMAL }).waitFor({ timeout: 20000 });
  await pausa(p, 3);
  await legenda(2, "Ficha completa no painel", "A ONG vê rua, número, CEP e o histórico de status: dados que o celular não recebe.", "web");
  await rolar(web, 350);
  await pausa(p, 4);

  // 3. Adotante entra no app e busca por raio (BFF Mobile)
  await legenda(3, "A adotante abre o app", "Outro cliente, outra rota: o App Mobile fala só com o /mobile/v1.", "mobile");
  await digitar(mob.locator("input[type=email]"), emailAdotante);
  await digitar(mob.locator("input[type=password]"), senha);
  await clicar(mob.getByRole("button", { name: "Entrar", exact: true }));
  await mob.getByRole("heading", { level: 1 }).first().waitFor();
  // o animal novo chega à busca pelo modelo de leitura (CQRS); espera a projeção
  const cartao = mob.getByRole("link").filter({ has: mob.getByRole("heading", { name: ANIMAL, exact: true }) }).first();
  for (let i = 0; i < 20 && !(await cartao.isVisible()); i++) {
    await mob.getByRole("link", { name: "Buscar" }).click();
    await pausa(p, 1);
  }
  await legenda(3, "Busca por raio", `A ${ANIMAL} já aparece: o BFF Mobile devolve cartões enxutos, com a distância e sem o endereço.`, "mobile");
  await pausa(p, 2);
  await destacar(cartao);
  await pausa(p, 3);

  // 4. Ficha no celular e pedido de adoção
  await clicar(cartao);
  await mob.getByRole("heading", { level: 1, name: ANIMAL }).waitFor();
  await legenda(4, "A mesma ficha, outra visão", "Só bairro, cidade e distância. Nada de rua, número ou coordenada (LGPD no desenho da API).", "ambos");
  await pausa(p, 3);
  await rolar(mob, 400);
  await pausa(p, 3);
  await legenda(4, "Quero adotar", "O pedido abre a SAGA de adoção no Orquestrador.", "mobile");
  await clicar(mob.getByRole("button", { name: `Quero adotar ${ANIMAL}` }));

  // 5. Linha do tempo da SAGA
  await mob.getByText("Aguardando aprovação").first().waitFor({ timeout: 45000 });
  await legenda(5, "A SAGA em andamento", "Reserva o animal, confere o perfil e espera a decisão da ONG. Cada passo vira um carimbo.", "mobile");
  await pausa(p, 4);
  await rolar(mob, 400);
  await pausa(p, 3);

  // 6. A ONG recebe o pedido e aprova
  await legenda(6, "O pedido chega ao painel", "A ONG vê quem pediu, com o perfil de adoção, para decidir com calma.", "web");
  await clicar(web.getByRole("link", { name: "Solicitações", exact: true }));
  const pedido = web.getByRole("link").filter({ hasText: ANIMAL }).filter({ hasText: "Ana Souza" }).first();
  await pedido.waitFor({ timeout: 30000 });
  await pausa(p, 2);
  await clicar(pedido);
  await web.getByRole("button", { name: "Aprovar adoção" }).waitFor({ timeout: 20000 });
  await pausa(p, 2);
  await rolar(web, 450);
  await pausa(p, 3);
  await legenda(6, "Aprovar adoção", "O botão só existe porque a resposta trouxe o link de ação (HATEOAS).", "web");
  await clicar(web.getByRole("button", { name: "Aprovar adoção" }));
  await web.getByText("Adoção concluída").first().waitFor({ timeout: 45000 });
  await pausa(p, 3);

  // 7. A adotante vê a adoção concluída e os avisos
  await legenda(7, "Do outro lado, em segundos", "O pedido muda para adoção concluída sem a adotante recarregar nada.", "mobile");
  await mob.getByText("Adoção concluída").first().waitFor({ timeout: 30000 });
  await rolar(mob, -800);
  await pausa(p, 4);
  await legenda(7, "Avisos", "O serviço de Notificações consumiu os eventos da SAGA e montou a caixa de entrada.", "mobile");
  await clicar(mob.getByRole("link", { name: /^Avisos/ }));
  await mob.getByRole("heading", { level: 1, name: "Avisos" }).waitFor();
  await mob.getByText(/Adoção concluída|Adoção aprovada/).first().waitFor({ timeout: 30000 });
  await pausa(p, 5);

  // 8. Assistente: pergunta com fontes e recomendação
  await legenda(8, "Assistente: dúvidas com fontes", "RAG: a resposta cita trechos da base de conhecimento da Ampara.", "mobile");
  await clicar(mob.getByRole("link", { name: "Assistente" }));
  await clicar(mob.getByRole("button", { name: "Dá para ter cachorro em apartamento?" }));
  await mob.locator("text=/\\[\\d\\]|Fontes|fonte/").first().waitFor({ timeout: 40000 }).catch(() => {});
  await pausa(p, 6);
  await legenda(8, "Quem combina comigo", "O agente chama a ferramenta de busca de animais e explica a escolha.", "mobile");
  await clicar(mob.getByRole("button", { name: "Quem combina comigo" }));
  await digitar(mob.locator("textarea[required]"), "Moro em apartamento pequeno e trabalho 8 horas fora de casa.");
  await clicar(mob.getByRole("button", { name: "Recomendar animais" }));
  await mob.getByRole("button", { name: "Recomendar animais" }).waitFor({ timeout: 40000 });
  await pausa(p, 3);
  await rolar(mob, 450);
  await pausa(p, 4);
  await rolar(mob, 450);
  await pausa(p, 5);

  // encerramento
  await fecharEtapa(9);
  await legenda(null, "", "", "ambos");
  await p.evaluate(() => window.capa("ampara", "Um animal, dois clientes, dois BFFs, uma SAGA."));
  marcadores.push({ t: (Date.now() - inicio) / 1000, n: 9, titulo: "Encerramento" });
  await p.waitForTimeout(MINIMO[9] * (RITMO / 1.5) * 1000);

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
  const linhas = marcadores.map((m) => `${mmss(m.t)}  ${m.n}. ${m.titulo}`);
  fs.writeFileSync(path.join(SAIDA, `marcadores-${carimbo}.txt`), linhas.join("\n") + "\n");
  console.log(`\nvídeo: ${fs.existsSync(mp4) ? mp4 : webm}\nmarcadores:\n${linhas.join("\n")}`);
}

main().catch((erro) => {
  console.error(`\nfalhou: ${erro.message}`);
  process.exit(1);
});
