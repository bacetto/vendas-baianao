// Portal Universo Baianão com o login do Ed (secrets ED_CPF / ED_SENHA): lê os pendentes e registra a decisão
// pela mesma API que a tela "Orçamentos para aprovação" usa.
import { chromium } from "playwright";

const BASE = "https://universobaianao.com.br";
const TELA = `${BASE}/portal/colaborador/processos/vendas/orcamentos-aprovacao`;

export async function abrirPortal() {
  const { ED_CPF, ED_SENHA } = process.env;
  if (!ED_CPF || !ED_SENHA) throw new Error("Faltam os secrets ED_CPF e ED_SENHA");
  const browser = await chromium.launch({ channel: process.env.CHROME_CANAL || "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "pt-BR", timezoneId: "America/Bahia" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);

  async function login() {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const cpf = page.getByPlaceholder(/CPF/i);
    await cpf.click();
    await cpf.pressSequentially(ED_CPF.replace(/\D/g, ""), { delay: 50 });
    const senha = page.locator('input[type="password"]');
    await senha.click();
    await senha.pressSequentially(ED_SENHA, { delay: 35 });
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Entrar$/i }).click();
    const colab = page.getByText(/^Portal do Colaborador$/i);
    await Promise.race([
      colab.waitFor({ timeout: 30000 }).then(() => colab.click()),
      page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }),
    ]).catch(() => {});
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 }).catch(() => {});
    if (/\/login/.test(page.url())) throw new Error("LOGIN: o portal não aceitou o login do Ed");
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!self.webpackChunk_N_E, null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    if (/\/login/.test(page.url())) throw new Error("LOGIN: caiu no login ao abrir a tela");
  }

  // chama a API do portal de dentro da página logada
  async function api(metodo, url, corpo) {
    return page.evaluate(async ([metodo, url, corpo]) => {
      let req;
      self.webpackChunk_N_E.push([[Symbol()], {}, (r) => { req = r; }]);
      let x = null;
      try { if (req(64665)?.x1?.get) x = req(64665).x1; } catch (e) {}
      if (!x) for (const m of Object.values(req.c || {})) { const y = m?.exports?.x1; if (y?.get && y?.post) { x = y; break; } }
      if (!x) throw new Error("cliente de API do portal não encontrado");
      try {
        const r = metodo === "post" ? await x.post(url, corpo) : await x.get(url);
        return { ok: true, r };
      } catch (e) { return { ok: false, status: e?.status, msg: String(e?.message || e) }; }
    }, [metodo, url, corpo]);
  }

  async function chamar(metodo, url, corpo) {
    let res = await api(metodo, url, corpo).catch((e) => ({ ok: false, msg: String(e.message) }));
    if (!res.ok && (res.status === 401 || /\/login/.test(page.url()) || /webpack|API do portal|Execution context/i.test(res.msg || ""))) {
      await login(); // sessão caiu: entra de novo e repete uma vez
      res = await api(metodo, url, corpo);
    }
    if (!res.ok) { const e = new Error(res.msg || "erro na API"); e.status = res.status; throw e; }
    return res.r;
  }

  await login();
  return {
    pendentes: async () => (await chamar("get", "/regras-desconto/orcamentos-avaliados?aba=pendente")).items || [],
    filiais: async () => {
      const out = [];
      for (let pg = 1; pg < 20; pg++) { const r = await chamar("get", `/filiais?page=${pg}`); out.push(...(r.items || [])); if (pg >= (r.pagination?.totalPages || 1)) break; }
      return out;
    },
    // mesmo corpo que o botão Aprovar/Reprovar da tela envia
    decidir: (item, decisao, nota) => chamar("post", "/regras-desconto/orcamentos-avaliados/decisao", {
      requestId: item.id, branchCode: item.branchCode, orderNumber: item.orderNumber,
      categoryCode: item.evaluation?.category?.code ?? item.products?.[0]?.categoryCode ?? "",
      protheusGroup: item.group, discountValue: item.discountValue, protheusType: item.type, itemGroup: item.itemGroup,
      decision: decisao, note: nota,
    }),
    fechar: () => browser.close().catch(() => {}),
  };
}
