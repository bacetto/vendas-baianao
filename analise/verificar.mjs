// Confere se a página da análise abre com os dados gerados: todas as abas renderizam, sem erro de JavaScript.
// Uso: node analise/verificar.mjs saida/analise.json [print.png]   (o print só é usado localmente; no GitHub não sai do runner)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [, , ARQ, PRINT] = process.argv;
const dados = fs.readFileSync(ARQ, "utf8");
const html = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "index.html"), "utf8")
  .replace("<script>", `<script>window.__ANALISE__=${dados.replace(/</g, "\\u003c")};</script><script>`);
const browser = await chromium.launch({ channel: process.env.CHROME_CANAL || "chrome" });
const erros = [];
try {
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 840 }]) {
    const page = await browser.newPage({ viewport: vp });
    page.on("pageerror", (e) => erros.push(e.message));
    // logo e fonte vêm de fora (site do Baianão / Google Fonts): se não carregarem no runner, não é erro da página
    page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) erros.push(m.text()); });
    await page.setContent(html, { waitUntil: "load" });
    for (const aba of ["geral", "plano", "regionais", "lojas", "vendedores", "produtos"]) {
      await page.click(`.tabs button[data-a="${aba}"]`);
      const n = await page.$$eval("main#m *", (x) => x.length);
      if (n < 15) erros.push(`aba ${aba} quase vazia (${n} elementos)`);
      if (aba === "lojas") { await page.click("tr.cl"); if (!(await page.$("tr.det"))) erros.push("detalhe da loja não abriu"); }
      if (PRINT && vp.width > 1000) await page.screenshot({ path: PRINT.replace(".png", `-${aba}.png`), fullPage: true });
    }
    await page.close();
  }
} finally { await browser.close(); }
if (erros.length) { console.log("❌ página com problema: " + erros.slice(0, 5).join(" | ").slice(0, 400)); process.exit(1); }
console.log("✅ página da análise renderizou todas as abas (desktop e celular), sem erros");
