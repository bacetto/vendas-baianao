// Entra no Universo Baianão e salva os relatórios em ./saida
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "https://universobaianao.com.br";
const PAINEL_NETLIFY = "https://vendas-baianao.netlify.app";
const PORTAL_CPF = process.env.PORTAL_CPF;
const PORTAL_SENHA = process.env.PORTAL_SENHA;
const PAINEL_SENHA = (process.env.PAINEL_SENHA || "").trim();
if (!PORTAL_CPF) throw new Error("Falta o secret PORTAL_CPF");
if (!PORTAL_SENHA) throw new Error("Falta o secret PORTAL_SENHA");

fs.mkdirSync("saida", { recursive: true });
const hoje = process.env.DIA ? process.env.DIA : new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const MES = process.env.PERIODO === "mes";
const MODO = process.env.MODO || (MES ? "mes" : "parcial"); // meta | parcial | final | mes
const ontem = new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 10);
const ate = process.env.MES_ATE ? process.env.MES_ATE : ontem;
const inicio = MES ? `${ate.slice(0, 8)}01` : hoje;
const fim = MES ? ate : hoje;
console.log(`Período: ${inicio} a ${fim}`);

const canal = process.env.CHROME_CANAL ? process.env.CHROME_CANAL : "chrome";
const browser = await chromium.launch({ channel: canal });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: "pt-BR", timezoneId: "America/Bahia", acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const cpf = page.getByPlaceholder(/CPF/i);
  await cpf.click();
  await cpf.pressSequentially(PORTAL_CPF.replace(/\D/g, ""), { delay: 60 });
  const senha = page.locator('input[type="password"]');
  await senha.click();
  await senha.pressSequentially(PORTAL_SENHA, { delay: 40 });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Entrar$/i }).click();
  const colab = page.getByText(/^Portal do Colaborador$/i);
  await Promise.race([
    colab.waitFor({ timeout: 30000 }).then(() => colab.click()),
    page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }),
  ]).catch(() => {});
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (/\/login/.test(page.url())) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    console.log("Ficou no login. Tela:", bodyText.replace(/\s+/g, " ").slice(0, 400));
    throw new Error("Login no portal não passou");
  }
  console.log("Depois do login:", page.url());
  console.log("✅ Login no portal ok");
}

async function setarDatas(ini = inicio, f = fim) {
  const inputs = page.locator('input[type="date"]');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) await inputs.nth(i).fill(i === 0 ? ini : f);
  const vals = await inputs.evaluateAll((els) => els.map((e) => e.value));
  console.log(`Datas na tela (${n} campos): ${vals.join(" , ")}`);
}

async function despejar(nome) {
  const linhas = await page.evaluate(() => [...document.querySelectorAll("tr")].map((tr) =>
    [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | ")).filter((l) => l.replace(/[\s|]/g, "")));
  fs.writeFileSync(`saida/${nome}.txt`, linhas.join("\n"));
  console.log(`--- TABELA ${nome} (${linhas.length} linhas) ---\n` + linhas.join("\n"));
}

// 1) Vendas Lojas -> cartões do topo + "Resultado por Regional"
async function regional() {
  await page.goto(`${BASE}/portal/colaborador/bi/vendas/vendas-lojas`, { waitUntil: "domcontentloaded" });
  const titulo = page.locator("p", { hasText: /^Resultado por Regional$/i });
  await titulo.waitFor();
  await setarDatas(inicio, fim);
  await page.getByRole("button", { name: /^Aplicar$/i }).click();
  await page.waitForTimeout(2000);
  await page.getByText("Carregando...").first().waitFor({ state: "hidden" }).catch(() => {});
  await titulo.waitFor();
  await page.getByText(/^Total Geral$/i).first().waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.evaluate(() => {
    const folhas = (re) => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && re.test(e.textContent.trim()));
    const t = [...document.querySelectorAll("p")].find((e) => /^Resultado por Regional$/i.test(e.textContent.trim()));
    const tot = folhas(/^Total Geral$/i)[0];
    let sec = t; while (sec && !sec.contains(tot)) sec = sec.parentElement;
    const pac = folhas(/^PACOTE DE SERVI/i);
    let cards = folhas(/^% ATINGIMENTO$/i)[0];
    while (cards && !pac.some((p) => cards.contains(p))) cards = cards.parentElement;
    const a = cards.getBoundingClientRect(), b = sec.getBoundingClientRect();
    const pad = 16, x = Math.min(a.left, b.left) - pad, y = a.top + scrollY - pad;
    return { x, y, width: Math.max(a.right, b.right) - x + pad, height: b.bottom + scrollY - y + pad };
  });
  await page.screenshot({ path: "saida/regional.png", clip: box, fullPage: true });
  console.log("✅ Print 1: Resultado por Regional");
  await despejar("regional");
}

// 2) Painel Vendas Leads -> aba "Resumo por Loja"
async function leads() {
  await page.goto(`${BASE}/portal/colaborador/bi/vendas/vendas-leads`, { waitUntil: "domcontentloaded" });
  await page.getByText(/^LEADS CONTATADOS$/i).first().waitFor({ timeout: 120000 });
  await setarDatas(inicio, fim);
  await page.getByRole("button", { name: /^Filtrar$/i }).click();
  await page.waitForTimeout(5000);
  await page.getByText(/^Resumo por Loja$/).first().click();
  await page.getByText(/^Total Geral$/i).last().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 10; i++) {
    const aberta = page.locator("tr", { hasText: /Subtotal R\d/ }).filter({ has: page.locator("svg.lucide-chevron-down") }).first();
    if (!(await aberta.count())) break;
    await aberta.locator("button").first().click();
    await page.waitForTimeout(300);
  }
  const sem = page.locator("tr", { hasText: /Subtotal Sem regional/ }).filter({ has: page.locator("svg.lucide-chevron-right") }).first();
  if (await sem.count()) { await sem.locator("button").first().click(); await page.waitForTimeout(300); }
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.evaluate(() => {
    const folhas = (re) => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && re.test(e.textContent.trim()));
    const fim = folhas(/^DIAS AT[ÉE] COMPRAR$/i);
    let cards = folhas(/^LEADS CONTATADOS$/i)[0];
    while (cards && !fim.some((f) => cards.contains(f))) cards = cards.parentElement;
    const tot = folhas(/^Total Geral$/i).pop();
    const tabela = tot.closest("table")?.parentElement ? tot.closest("table").parentElement : tot.parentElement;
    const a = cards.getBoundingClientRect(), b = tabela.getBoundingClientRect();
    const pad = 16, x = Math.min(a.left, b.left) - pad, y = a.top + scrollY - pad;
    return { x, y, width: Math.max(a.right, b.right) - x + pad, height: b.bottom + scrollY - y + pad };
  });
  await page.screenshot({ path: "saida/leads.png", clip: box, fullPage: true });
  await despejar("leads");
  try {
    for (let i = 0; i < 10; i++) {
      const fechada = page.locator("tr", { hasText: /Subtotal R\d/ }).filter({ has: page.locator("svg.lucide-chevron-right") }).first();
      if (!(await fechada.count())) break;
      await fechada.locator("button").first().click();
      await page.waitForTimeout(300);
    }
    await despejar("lojas");
  } catch (e) { console.log("Não leu os nomes das lojas:", e.message); }
  console.log("✅ Print 2: Painel Vendas Leads");
}

// 3) Painel vendas-baianao.netlify.app -> prints "Por categoria" (Ontem e Mês)
async function categoriasNetlify() {
  try {
    await page.goto(PAINEL_NETLIFY, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const campoSenha = page.locator('input[type="password"]').first();
    if (await campoSenha.count()) {
      await campoSenha.click();
      await campoSenha.fill(PAINEL_SENHA);
      await page.getByRole("button", { name: /^Entrar$/i }).click();
      await page.waitForTimeout(3000);
    }

    await page.getByText(/Por categoria/i).first().waitFor({ state: "attached", timeout: 25000 });
    await page.waitForTimeout(1500);

    const clicarPeriodo = async (chave, reTexto) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      const aba = page.locator(`#tabsP button[data-p="${chave}"]`);
      if (await aba.count()) await aba.first().click();
      else await page.locator("button, a, div, span").filter({ hasText: reTexto }).last().click();
      await page.waitForTimeout(2500);
    };

    // mesma composição nas 2 fotos: categorias sempre na mesma ordem (o painel ordena por valor)
    const ORDEM = ["moveis", "colchoes e box", "estofado", "eletro", "eletroportateis"];
    const fixarOrdem = () => page.evaluate((ordem) => {
      const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      for (const box of document.querySelectorAll(".cats")) {
        const idx = (c) => { const i = ordem.indexOf(norm(c.querySelector(".n")?.textContent)); return i < 0 ? 99 : i; };
        [...box.children].sort((a, b) => idx(a) - idx(b)).forEach((c) => box.appendChild(c));
      }
    }, ORDEM);

    const recortarCardCategoria = async (arquivoSaida) => {
      const tit = page.getByText(/Por categoria/i).first();
      await tit.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await fixarOrdem();
      const boxCat = await page.evaluate(() => {
        const folhas = (re) => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && re.test(e.textContent.trim()));
        const titulo = folhas(/^Por categoria$/i)[0];
        const fim = folhas(/^Eletroport[áa]teis$/i)[0];
        if (!titulo || !fim) return null;
        let sec = titulo;
        while (sec && !sec.contains(fim)) sec = sec.parentElement;
        if (!sec) return null;
        for (let i = 0; i < 3; i++) {
          const pai = sec.parentElement;
          if (!pai) break;
          const txt = pai.innerText || "";
          if (/Leads\s*\(/i.test(txt) || /R1\s*·/i.test(txt)) break;
          sec = pai;
        }
        const r = sec.getBoundingClientRect();
        return {
          x: Math.max(0, r.left + scrollX),
          y: Math.max(0, r.top + scrollY),
          width: r.width,
          height: r.height,
        };
      });
      if (boxCat && boxCat.width > 100 && boxCat.height > 40) {
        await page.screenshot({ path: arquivoSaida, clip: boxCat, fullPage: true });
        console.log(`✅ Print categoria: ${arquivoSaida}`, JSON.stringify(boxCat));
      } else {
        console.log(`Aviso: card Por categoria não encontrado para ${arquivoSaida}:`, boxCat);
      }
    };

    const quando = await page.evaluate(() => document.body.innerText.match(/atualizad[oa][^\n]{0,40}/i)?.[0] || "").catch(() => "");
    console.log("Painel Netlify:", quando || "(sem horário na tela)");

    // 1ª foto: dia (Ontem no relatório do mês; Hoje na parcial/final)
    if (MES) await clicarPeriodo("ontem", /^Ontem$/i);
    else await clicarPeriodo("hoje", /^Hoje$/i);
    await recortarCardCategoria("saida/categoria-dia.png");

    // 2ª foto: Mês (parcial do mês)
    await clicarPeriodo("mes", /^M[êe]s$/i);
    await recortarCardCategoria("saida/categoria-mes.png");
  } catch (e) {
    const tela = await page.locator("body").innerText().catch(() => "");
    console.log("Aviso categoriasNetlify:", e.message, "| Tela:", tela.replace(/\s+/g, " ").slice(0, 300));
  }
}

try {
  await login();
  await regional();
  // meta do dia só usa o print das regionais; nos outros, se o painel de leads ainda estiver vazio
  // (domingo cedo, por ex.) segue sem ele em vez de derrubar o envio inteiro
  if (MODO !== "meta") {
    // o portal às vezes demora a abrir os leads: até 3 tentativas antes de seguir sem eles
    for (let t = 1; t <= 3; t++) {
      try { await leads(); break; }
      catch (e) {
        console.log(`⚠️ Leads: tentativa ${t} falhou (${String(e.message).split("\n")[0].slice(0, 80)})`);
        if (t === 3) console.log("⚠️ Print de leads falhou 3 vezes, seguindo sem ele");
        else await page.waitForTimeout(15000);
      }
    }
  }
  if (MODO !== "meta") await categoriasNetlify();
} catch (e) {
  await page.screenshot({ path: "saida/erro.png", fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
