// Portal Universo Baianão com o login do Ed (secrets ED_CPF / ED_SENHA): lê os pendentes e registra a decisão
// pela mesma API que a tela "Orçamentos para aprovação" usa.
import { chromium } from "playwright";

const BASE = "https://universobaianao.com.br";
const TELA = `${BASE}/portal/colaborador/processos/vendas/orcamentos-aprovacao`;

// margem do regional como o portal mostra (margem.percentual; vem em fração 0,40 ou em % 40). Sem ela: lucro / custo.
export function margemPct(m, venda) {
  let v = Number(m?.percentual);
  if (Number.isFinite(v) && v !== 0) v = Math.abs(v) <= 1.5 ? v * 100 : v;
  else if (typeof m?.lucro === "number" && venda - m.lucro > 0) v = (100 * m.lucro) / (venda - m.lucro);
  else return null;
  return Number.isFinite(v) && v > -100 && v < 100 ? v : null;
}

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
    if (/\/login/.test(page.url())) {
      // só é "senha errada" se o portal disser isso na tela; senão é o portal instável (tenta de novo sem alarme)
      const tela = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (/inv[aá]lid|incorret|n[aã]o confere|senha errad|bloquead|usu[aá]rio n[aã]o encontrad/i.test(tela)) throw new Error("SENHA: o portal recusou o login do Ed");
      throw new Error("PORTAL: o login não completou (portal lento/instável)");
    }
    await page.goto(TELA, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!self.webpackChunk_N_E, null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    if (/\/login/.test(page.url())) throw new Error("PORTAL: caiu no login ao abrir a tela");
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
    // parcial do DIA por regional (margem e % de serviços) — pro boletim do Ed; não mexe nos números do mês do robô
    resumoDia: async () => {
      const d = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      const r = await chamar("get", `/vendas-lojas/resumo?dataInicio=${d}&dataFim=${d}`);
      const out = {};
      for (const g of r?.porRegional || []) {
        const venda = g.mercantil?.venda || 0, pac = g.pacoteServicos?.valor || 0;
        if (/^R[1-9]$/.test(g.regional) && venda > 0) out[g.regional] = { venda, pct: (100 * pac) / venda, margem: margemPct(g.margem, venda) };
      }
      return out;
    },
    // venda de HOJE por loja (só lojas com meta hoje = abertas) — pro boletim das lojas abaixo de R$ 5 mil
    lojasHoje: async () => {
      const d = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      const r = await chamar("get", `/vendas-lojas/resumo?dataInicio=${d}&dataFim=${d}`);
      return (r?.porLoja || []).filter((l) => (l.mercantil?.meta || 0) > 0)
        .map((l) => ({ num: Number(String(l.filial || l.loja || "").replace(/\D/g, "").slice(-4)) || 0, regional: l.regional, venda: Number(l.mercantil?.venda) || 0 }))
        .filter((l) => l.num > 0);
    },
    // resumo do mês por regional (venda e pacote de serviços = Sorte Dobrada + Garantia). Consulta pesada (~1 min).
    // números do DIA de cada regional (venda, lucro, custo, serviços) — base das regras M e S do robô
    numerosDia: async () => {
      const d = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      const r = await chamar("get", `/vendas-lojas/resumo?dataInicio=${d}&dataFim=${d}`);
      const out = {};
      for (const g of r?.porRegional || []) {
        const venda = g.mercantil?.venda || 0, pac = g.pacoteServicos?.valor || 0;
        if (/^R[1-9]$/.test(g.regional) && venda > 0) out[g.regional] = { dia: d, venda, pacote: pac, lucro: g.margem?.lucro ?? null, custo: g.margem?.custoVenda ?? (typeof g.margem?.lucro === "number" ? venda - g.margem.lucro : null), pct: (100 * pac) / venda, margem: margemPct(g.margem, venda) };
      }
      // CONFERÊNCIA: o total de cada regional tem que bater com a soma das lojas dele (por loja do mesmo resumo).
      // Se não bater (diferença > 0,05 p.p. nos serviços ou > 0,5% na venda), o regional fica sem números -> o robô não aprova nada dele.
      const soma = {};
      for (const l of r?.porLoja || []) {
        const k = String(l.regional || "").trim();
        (soma[k] ||= { venda: 0, pacote: 0 });
        soma[k].venda += l.mercantil?.venda || 0; soma[k].pacote += l.pacoteServicos?.valor || 0;
      }
      for (const [k, o] of Object.entries(out)) {
        const s = soma[k];
        const okVenda = s && Math.abs(s.venda - o.venda) <= 0.005 * o.venda;
        const okServ = s && s.venda > 0 && Math.abs((100 * s.pacote) / s.venda - o.pct) <= 0.05;
        const okPortal = (() => { const g = (r.porRegional || []).find((x) => x.regional === k); const pp = g?.pacoteServicos?.percentual; return typeof pp !== "number" || Math.abs(pp * 100 - o.pct) <= 0.05; })();
        const okMargem = typeof o.lucro === "number" && o.custo > 0 && o.margem != null && Math.abs((100 * o.lucro) / o.custo - o.margem) <= 0.05;
        o.conferido = !!(okVenda && okServ && okPortal && okMargem);
        if (!o.conferido) { console.log(`⚠️ conferência falhou no ${k}: números do regional não batem com a soma das lojas`); delete out[k]; }
      }
      return out;
    },
    // histórico (já decididos) de um número de pedido
    historico: async (pedido) => (await chamar("get", `/regras-desconto/historico-orcamentos?aba=analisados&page=1&pageSize=10&search=${encodeURIComponent(pedido)}`)).items || [],
    fechar: () => browser.close().catch(() => {}),
  };
}
