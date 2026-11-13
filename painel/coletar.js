// Entra no Universo Baianão, lê as vendas pela API do próprio portal e grava saida/dados.json (só números agregados)
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { agregarPainel, periodosPainel } = require("./agregar.cjs");
const { coletarRawPainel } = require("./coleta-pagina.cjs");

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

try {
  await login();
  await page.goto(`${BASE}/portal/colaborador/bi/vendas/vendas-lojas`, { waitUntil: "domcontentloaded" });
  // só espera o portal carregar o cliente de API; a tela pode demorar e não é usada
  await page.waitForFunction(() => !!self.webpackChunk_N_E, null, { timeout: 90000 });
  await page.getByText(/^Total Geral$/i).first().waitFor({ timeout: 30000 }).catch(() => {});
  const P = periodosPainel();
  // meta de cada dia: lê do portal uma vez por dia e guarda
  const CACHE = "saida/metas-dia.json";
  try { const c = JSON.parse(fs.readFileSync(CACHE, "utf8")); if (c.dia === P.hoje.inicio && !c.metas.includes(null)) P.metasDia = c.metas; } catch (e) {}
  const raw = await page.evaluate(coletarRawPainel, P);
  if (Array.isArray(raw.metasDia) && !raw.metasDia.includes(null)) fs.writeFileSync(CACHE, JSON.stringify({ dia: P.hoje.inicio, metas: raw.metasDia }));
  const dados = agregarPainel(raw);
  fs.writeFileSync("saida/dados.json", JSON.stringify(dados));
  const m = dados.periodos.mes, h = dados.periodos.hoje;
  console.log(`✅ dados.json: ${(fs.statSync("saida/dados.json").size / 1024).toFixed(0)} KB | hoje R$ ${h.resumo?.geral.venda} | mês R$ ${m.resumo?.geral.venda} | ${m.vendedores.length} vendedores | ${m.produtos.length} produtos`);
} catch (e) {
  await page.screenshot({ path: "saida/erro-painel.png", fullPage: true }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
