// Entra no Universo Baianão, lê as vendas pela API do próprio portal e grava saida/dados.json (só números agregados)
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { agregarPainel, periodosPainel } = require("./agregar.cjs");
const { coletarRawPainel } = require("./coleta-pagina.cjs");
import { coletarZep } from "./zep.mjs";

const BASE = "https://universobaianao.com.br";
const { PORTAL_CPF, PORTAL_SENHA } = process.env;
if (!PORTAL_CPF || !PORTAL_SENHA) throw new Error("Faltam os secrets PORTAL_CPF e PORTAL_SENHA");
fs.mkdirSync("saida", { recursive: true });

const browser = await chromium.launch({ channel: process.env.CHROME_CANAL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "pt-BR", timezoneId: "America/Bahia" });
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
  if (/\/login/.test(page.url())) throw new Error("Login no portal não passou");
  console.log("✅ Login no portal ok");
}

// Venda do dia hora a hora: o portal não dá a hora da venda, então a cada leitura guardamos
// quanto o dia já vendeu (rede e cada regional). Fica guardado junto com os dados (cifrado), 62 dias.
async function historicoHoras(dados) {
  const ARQ = "saida/historico-horas.json";
  let hist = null;
  try { hist = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch (e) {}
  if (!hist && process.env.REPO && process.env.SENHA) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${process.env.REPO}/dados/dados.enc?t=${Date.now()}`);
      if (r.ok) {
        const crypto = await import("node:crypto"), zlib = await import("node:zlib");
        const e = await r.json(), b = Buffer.from(e.dados, "base64");
        const k = crypto.pbkdf2Sync(process.env.SENHA, Buffer.from(e.salt, "base64"), e.iter, 32, "sha256");
        const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
        d.setAuthTag(b.subarray(-16));
        hist = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(0, -16)), d.final()]))).historicoHoras || null;
      }
    } catch (e) { console.log("Histórico anterior não lido:", e.message); }
  }
  hist = hist && typeof hist === "object" ? hist : {};
  const h = dados.periodos.hoje, g = h.resumo?.geral;
  if (g) {
    const loc = new Date(Date.now() - 3 * 3600e3), min = loc.getUTCHours() * 60 + loc.getUTCMinutes();
    const ponto = [min, g.venda, ...["R1", "R2", "R3", "R4"].map((r) => h.resumo.regionais.find((x) => x.reg === r)?.venda || 0)];
    const lista = (hist[h.inicio] ||= []);
    if (!lista.length || lista[lista.length - 1][0] !== min) lista.push(ponto);
  }
  const corte = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10);
  for (const dia of Object.keys(hist)) if (dia < corte) delete hist[dia];
  fs.writeFileSync(ARQ, JSON.stringify(hist));
  return hist;
}

try {
  await login();
  await page.goto(`${BASE}/portal/colaborador/bi/vendas/vendas-lojas`, { waitUntil: "domcontentloaded" });
  // só espera o portal carregar o cliente de API; a tela pode demorar e não é usada
  await page.waitForFunction(() => !!self.webpackChunk_N_E, null, { timeout: 90000 });
  await page.getByText(/^Total Geral$/i).first().waitFor({ timeout: 30000 }).catch(() => {});
  const P = periodosPainel();
  // meta de cada dia: lê do portal uma vez por dia e guarda
  const CACHE = "saida/metas-dia-v2.json";
  try { const c = JSON.parse(fs.readFileSync(CACHE, "utf8")); if (c.dia === P.hoje.inicio && !c.metas.includes(null)) P.metasDia = c.metas; } catch (e) {}
  const raw = await page.evaluate(coletarRawPainel, P);
  if (Array.isArray(raw.metasDia) && !raw.metasDia.includes(null)) fs.writeFileSync(CACHE, JSON.stringify({ dia: P.hoje.inicio, metas: raw.metasDia }));
  const dados = agregarPainel(raw);
  dados.historicoHoras = await historicoHoras(dados);
  // ZepSystem (outra plataforma de vendas): se falhar, o painel do Universo segue normal
  try { const z = await coletarZep(browser, dados); if (z) dados.zep = z; } catch (e) { console.log("⚠️ ZepSystem não lido:", String(e.message).slice(0, 120)); }
  fs.writeFileSync("saida/dados.json", JSON.stringify(dados));
  const m = dados.periodos.mes, h = dados.periodos.hoje;
  // registro público: sem valores de venda
  console.log(`✅ dados.json: ${(fs.statSync("saida/dados.json").size / 1024).toFixed(0)} KB | ${m.vendedores.length} vendedores | ${m.produtos.length} produtos${dados.zep ? " | ZepSystem ok" : ""}`);
} catch (e) {
  await page.screenshot({ path: "saida/erro-painel.png", fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
