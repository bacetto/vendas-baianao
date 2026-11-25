// Diagnóstico: faz o login igual ao robô e mostra cada passo (sem imprimir CPF/senha).
import { chromium } from "playwright";
const { ED_CPF, ED_SENHA } = process.env;
const browser = await chromium.launch({ channel: process.env.CHROME_CANAL || "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "pt-BR", timezoneId: "America/Bahia" });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const estado = async (rot) => {
  const bot = await page.$$eval("button", (b) => b.map((x) => `"${x.innerText.trim().slice(0,30)}"${x.disabled ? "(desab)" : ""}`)).catch(() => []);
  const txt = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "<cpf>").slice(0, 300);
  console.log(`[${rot}] URL=${page.url()} | botões=${bot.join(",")} | texto=${txt}`);
};
const passo = async (rot, fn) => { try { await fn(); console.log(`OK ${rot}`); } catch (e) { console.log(`FALHOU ${rot}: ${e.message.split("\n")[0]}`); await estado(rot); } };
await passo("goto", () => page.goto("https://universobaianao.com.br/login", { waitUntil: "networkidle" }));
await estado("abriu");
await passo("cpf", async () => { const c = page.getByPlaceholder(/CPF/i); await c.click(); await c.pressSequentially(ED_CPF.replace(/\D/g, ""), { delay: 50 }); });
await estado("depois do CPF");
await passo("senha", async () => { const s = page.locator('input[type="password"]'); await s.click(); await s.pressSequentially(ED_SENHA, { delay: 35 }); });
await page.waitForTimeout(400);
await estado("depois da senha");
await passo("Entrar", () => page.getByRole("button", { name: /^Entrar$/i }).click());
await page.waitForTimeout(8000);
await estado("8s depois do Entrar");
await page.waitForTimeout(15000);
await estado("23s depois do Entrar");
await browser.close();
