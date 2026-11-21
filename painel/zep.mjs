// ZepSystem (gestao.zepsystem.com.br): outra plataforma de vendas da mesma rede (mesmas lojas e vendedores).
// Entra com ZEP_EMAIL/ZEP_SENHA, lê o CSV de pedidos e os itens de cada pedido (só GET, nunca altera nada)
// e devolve SÓ números agregados (sem nome/dado de cliente).
import fs from "node:fs";

const BASE = "https://gestao.zepsystem.com.br";
const CACHE_ITENS = "saida/zep-itens.json"; // itens de pedido não mudam: guarda pra não reler

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const r2 = (x) => Math.round((x || 0) * 100) / 100;

// roda DENTRO da página logada do Zep
async function lerZepNaPagina({ de, ate, jaTenho }) {
  const csvTxt = await fetch(`/pedidos?de=${de}&ate=${ate}&exportar=csv`, { credentials: "include" }).then((r) => {
    if (!r.ok || !/csv/.test(r.headers.get("content-type") || "")) throw new Error("CSV de pedidos não veio (" + r.status + ")");
    return r.text();
  });
  // CSV ; com aspas
  const linhas = [];
  for (const l of csvTxt.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!l.trim()) continue;
    const c = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ";") { c.push(cur); cur = ""; } else cur += ch;
    }
    c.push(cur); linhas.push(c);
  }
  const cab = linhas.shift().map((x) => x.trim().toLowerCase());
  const ix = (n) => cab.findIndex((x) => x.startsWith(n));
  const I = { id: ix("pedido"), cod: ix("c"), data: ix("data"), hora: ix("hora"), vend: ix("vendedor"), total: ix("total"), pag: ix("pagamento"), st: ix("status") };
  const num = (s) => Number(String(s || "0").replace(/[^\d,-]/g, "").replace(",", ".")) || 0;
  const pedidos = linhas.map((c) => {
    const [d, m, y] = (c[I.data] || "").split("/");
    return { id: String(c[I.id] || "").replace(/\D/g, ""), data: `${y}-${m}-${d}`, hora: Number((c[I.hora] || "0").split(":")[0]) || 0,
      vendedor: (c[I.vend] || "").trim(), total: num(c[I.total]), pagamento: (c[I.pag] || "").trim() || "Outro", status: (c[I.st] || "").trim() || "?" };
  });
  // itens dos pedidos não cancelados que ainda não temos
  const faltam = pedidos.filter((p) => p.status.toLowerCase() !== "cancelado" && p.id && !jaTenho.includes(p.id)).map((p) => p.id);
  const itens = {};
  const lerUm = async (id) => {
    for (let t = 0; t < 3; t++) {
      try {
        const h = await fetch(`/imprimir/${id}`, { credentials: "include" }).then((r) => r.text());
        const d = new DOMParser().parseFromString(h, "text/html");
        const tab = [...d.querySelectorAll("table")].find((t) => /produto/i.test(t.querySelector("th")?.innerText || t.innerText));
        if (!tab) return;
        const heads = [...tab.querySelectorAll("th")].map((x) => x.innerText.trim().toLowerCase());
        const hi = (n) => heads.findIndex((x) => x.startsWith(n));
        itens[id] = [...tab.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((x) => x.innerText.trim())).filter((c) => c.length >= 3)
          .map((c) => ({ nome: c[hi("produto")] || c[0], sku: c[hi("sku")] || "", qtd: num(c[hi("qtd")]) || 1, total: num(c[hi("total")]) }));
        return;
      } catch (e) { await new Promise((r) => setTimeout(r, 1500)); }
    }
  };
  for (let i = 0; i < faltam.length; i += 4) await Promise.all(faltam.slice(i, i + 4).map(lerUm)); // devagar pra não pesar o site
  return { pedidos, itens };
}

export async function coletarZep(browser, dados) {
  const { ZEP_EMAIL, ZEP_SENHA } = process.env;
  if (!ZEP_EMAIL || !ZEP_SENHA) return null;
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Bahia" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    if (/\/login/.test(page.url())) {
      await page.locator('input[type="email"], input[name*="mail" i]').first().fill(ZEP_EMAIL);
      await page.locator('input[type="password"]').first().fill(ZEP_SENHA);
      await Promise.all([page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
        page.locator('button[type="submit"], input[type="submit"], button:has-text("Entrar")').first().click()]);
      if (/\/login/.test(page.url())) throw new Error("Login no ZepSystem não passou");
    }
    const P = dados.periodos;
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(CACHE_ITENS, "utf8")); } catch (e) {}
    const raw = await page.evaluate(lerZepNaPagina, { de: P.mesAnt.inicio, ate: P.hoje.fim, jaTenho: Object.keys(cache) });
    Object.assign(cache, raw.itens);
    fs.writeFileSync(CACHE_ITENS, JSON.stringify(cache));
    const z = agregarZep(raw.pedidos, cache, dados);
    console.log(`✅ ZepSystem lido (${Object.keys(cache).length} pedidos com itens)`);
    return z;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// vendedor do Zep -> loja: pelo nome, usando os vendedores do Universo (mesmas pessoas)
function mapaVendedorLoja(dados) {
  const m = {};
  for (const k of ["mesAnt", "mes"]) for (const v of dados.periodos[k]?.vendedores || []) {
    const n = norm(v.nome); if (!n) continue;
    if (!m[n] || v.venda > m[n].venda) m[n] = { loja: v.loja, venda: v.venda };
  }
  const out = {}; for (const n in m) out[n] = m[n].loja;
  return out;
}

export function agregarZep(pedidos, itens, dados) {
  const lojaDe = mapaVendedorLoja(dados);
  const achaLoja = (nome) => {
    const n = norm(nome); if (!n) return "";
    if (lojaDe[n]) return lojaDe[n];
    // nome no Zep pode estar abreviado: casa pelo começo (primeiro + segundo nome)
    const p = n.split(" ").slice(0, 2).join(" ");
    const cands = Object.keys(lojaDe).filter((k) => k.startsWith(p));
    return cands.length === 1 ? lojaDe[cands[0]] : "";
  };
  const ehCancel = (s) => /cancel/i.test(s);
  const ehAguard = (s) => /aguard/i.test(s);
  const P = dados.periodos;
  const nDias = (k) => k === "mes" ? Number(P.mes.fim.slice(8)) : k === "mesAnt" ? Number(P.mesAnt.fim.slice(8)) : 1;
  function periodo(k) {
    const { inicio, fim } = P[k];
    const sel = pedidos.filter((p) => p.data >= inicio && p.data <= fim);
    const status = {}, pag = {}, vend = {}, lojas = {}, prods = {}, porHora = Array(24).fill(0), porDia = Array(nDias(k)).fill(0), pedDia = Array(nDias(k)).fill(0);
    let vendido = 0, aguardando = 0, cancelado = 0, nVal = 0, nCanc = 0, nAg = 0;
    for (const p of sel) {
      status[p.status] = (status[p.status] || 0) + 1;
      const c = ehCancel(p.status), a = ehAguard(p.status);
      const loja = achaLoja(p.vendedor);
      const kv = norm(p.vendedor) || "LOJA (SEM VENDEDOR)";
      vend[kv] ??= { nome: p.vendedor || "Loja (sem vendedor)", loja, pedidos: 0, venda: 0, aguardando: 0, cancelados: 0, valorCancelado: 0 };
      if (c) { cancelado += p.total; nCanc++; vend[kv].cancelados++; vend[kv].valorCancelado += p.total; continue; }
      if (a) { aguardando += p.total; nAg++; vend[kv].aguardando += p.total; }
      else { vendido += p.total; nVal++; vend[kv].pedidos++; vend[kv].venda += p.total;
        pag[p.pagamento] ??= { nome: p.pagamento, pedidos: 0, valor: 0 }; pag[p.pagamento].pedidos++; pag[p.pagamento].valor += p.total;
        porHora[p.hora] += p.total;
        const d = Number(p.data.slice(8)) - 1; if (k.startsWith("mes") && d >= 0 && d < porDia.length) { porDia[d] += p.total; pedDia[d]++; }
        if (loja) { lojas[loja] ??= { cod: loja, venda: 0, pedidos: 0 }; lojas[loja].venda += p.total; lojas[loja].pedidos++; }
        for (const it of itens[p.id] || []) {
          const kp = it.sku || norm(it.nome);
          prods[kp] ??= { sku: it.sku, nome: it.nome, qtd: 0, valor: 0, pedidos: 0 };
          prods[kp].qtd += it.qtd; prods[kp].valor += it.total; prods[kp].pedidos++;
        }
      }
    }
    const semLoja = Object.values(vend).filter((v) => !v.loja && v.venda > 0).reduce((s, v) => s + v.venda, 0);
    return {
      label: P[k].label, inicio, fim,
      vendido: r2(vendido), aguardando: r2(aguardando), cancelado: r2(cancelado),
      pedidos: nVal, pedidosAguardando: nAg, pedidosCancelados: nCanc, pedidosTotal: sel.length,
      ticket: nVal ? r2(vendido / nVal) : 0, taxaCancelamento: sel.length ? nCanc / sel.length : 0,
      status, pagamentos: Object.values(pag).map((x) => ({ ...x, valor: r2(x.valor) })).sort((a, b) => b.valor - a.valor),
      vendedores: Object.values(vend).map((x) => ({ ...x, venda: r2(x.venda), aguardando: r2(x.aguardando), valorCancelado: r2(x.valorCancelado) })).sort((a, b) => b.venda - a.venda),
      lojas: Object.values(lojas).map((x) => ({ ...x, venda: r2(x.venda) })).sort((a, b) => b.venda - a.venda),
      vendaSemLoja: r2(semLoja),
      produtos: Object.values(prods).map((x) => ({ ...x, valor: r2(x.valor) })).sort((a, b) => b.valor - a.valor).slice(0, 300),
      porHora: porHora.map(r2), porDia: porDia.map(r2), pedidosPorDia: pedDia,
    };
  }
  return {
    geradoEm: new Date().toISOString(),
    inicioPlataforma: pedidos.map((p) => p.data).filter((d) => /^\d{4}-/.test(d)).sort()[0] || null,
    periodos: { hoje: periodo("hoje"), ontem: periodo("ontem"), mes: periodo("mes"), mesAnt: periodo("mesAnt") },
  };
}
