// Diagnóstico (sem senha): abre a tela de login do portal como o robô e mostra o que aparece.
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: process.env.CHROME_CANAL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "pt-BR", timezoneId: "America/Bahia" });
const page = await ctx.newPage();
page.on("response", (r) => { if (/universobaianao/.test(r.url()) && r.request().resourceType() === "document") console.log("DOC", r.status(), r.url(), r.headers()["cf-mitigated"] || ""); });
const t0 = Date.now();
try { await page.goto("https://universobaianao.com.br/login", { waitUntil: "networkidle", timeout: 90000 }); } catch (e) { console.log("GOTO ERRO", e.message.split("\n")[0]); }
console.log("tempo", Date.now() - t0, "ms");
for (const espera of [0, 10000, 20000]) {
  await page.waitForTimeout(espera);
  console.log("---- após", espera, "ms | URL", page.url(), "| título", await page.title());
  const txt = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  console.log("TEXTO", txt);
  const bot = await page.$$eval("button", (b) => b.map((x) => `[${x.type}] "${x.innerText.trim()}" aria="${x.getAttribute("aria-label") || ""}" disabled=${x.disabled}`)).catch(() => []);
  console.log("BOTÕES", JSON.stringify(bot));
  console.log("placeholder CPF:", await page.getByPlaceholder(/CPF/i).count(), "| botão Entrar (role):", await page.getByRole("button", { name: /^Entrar$/i }).count());
}
await browser.close();
