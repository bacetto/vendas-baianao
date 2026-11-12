// Transforma as respostas cruas da API do Universo Baianão no JSON do painel.
// Só sai número agregado: nada de CPF, nome de cliente ou pedido individual.
function agregarPainel(raw) {
  const LIDER = { R1: "UARA", R2: "DIEGO", R3: "ALEXANDRE", R4: "MICHEL" };
  const r2 = (x) => Math.round((x || 0) * 100) / 100;
  const limpa = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const dia = (iso) => Number(iso.slice(8, 10));

  // ---- lojas (filiais) ----
  const lojas = {};
  for (const f of raw.filiais || []) {
    const cod = limpa(f.codigoProtheus);
    if (!/^001\d{4}$/.test(cod)) continue;
    const num = Number(cod.slice(3));
    lojas[cod] = { num, nome: limpa(f.tradeName) || limpa(f.name), regional: limpa(f.regional) || "Sem regional" };
  }
  const garanteLoja = (cod, reg) => {
    cod = limpa(cod);
    if (!lojas[cod]) lojas[cod] = { num: Number(cod.slice(3)) || 0, nome: "", regional: reg || "Sem regional" };
    if (reg && reg !== "Sem regional" && lojas[cod].regional === "Sem regional") lojas[cod].regional = reg;
    return cod;
  };
  const numDaLoja = (txt) => { const t = limpa(txt); if (/^001\d{4}$/.test(t)) return t; const m = t.match(/(\d+)/); return m ? `001${m[1].padStart(4, "0")}` : t; };

  // ---- resumo (meta, venda, margem) ----
  const ind = (o) => ({
    venda: r2(o.mercantil?.venda), meta: r2(o.mercantil?.meta), pct: o.mercantil?.percentualAtingimento || 0,
    lucro: r2(o.margem?.lucro), margem: o.margem?.percentual || 0,
    sorteQtd: o.sorte?.qtde || 0, sorteValor: r2(o.sorte?.valor),
    garantia: r2(o.garantia?.valor), pacote: r2(o.pacoteServicos?.valor),
  });
  const resumo = (res) => {
    if (!res?.geral) return null;
    const cats = Object.fromEntries((res.categorias || []).map((c) => [c.codigo, limpa(c.descricao)]));
    const porCat = {};
    for (const l of res.porLoja || []) for (const c of l.porCategoria || []) {
      const k = cats[c.codigo] || c.codigo;
      porCat[k] ??= { nome: k, venda: 0, meta: 0 };
      porCat[k].venda += c.venda || 0; porCat[k].meta += c.meta || 0;
    }
    return {
      geral: ind(res.geral),
      regionais: (res.porRegional || []).filter((r) => /^R[1-9]$/.test(r.regional))
        .map((r) => ({ reg: r.regional, lider: LIDER[r.regional] || "", ...ind(r) })),
      lojas: (res.porLoja || []).map((l) => ({ cod: garanteLoja(l.filial || l.loja, limpa(l.regional)), ...ind(l) })),
      categorias: Object.values(porCat).map((c) => ({ ...c, venda: r2(c.venda), meta: r2(c.meta) })).filter((c) => c.venda || c.meta).sort((a, b) => b.venda - a.venda),
    };
  };

  // ---- itens (loja x vendedor x produto) ----
  function itens(linhas, ini, fim) {
    const sel = (linhas || []).filter((l) => l.data >= ini && l.data <= fim);
    const vend = {}, prod = {}, grupos = {}, marcas = {}, pedidos = new Set(), pedLoja = {};
    let bruto = 0, devol = 0;
    for (const l of sel) {
      const cod = garanteLoja(numDaLoja(l.loja));
      const v = l.valorTotal || 0, q = l.quantidade || 0;
      if (l.tipo === "DEVOLUCAO") devol += v; else bruto += v;
      if (l.tipo !== "DEVOLUCAO") { const p = `${cod}|${l.pedido}`; if (!pedidos.has(p)) { pedidos.add(p); pedLoja[cod] = (pedLoja[cod] || 0) + 1; } }
      const [vc, ...vn] = limpa(l.vendedor).split(" - ");
      const kv = `${vc}|${cod}`;
      vend[kv] ??= { cod: vc, nome: vn.join(" - ") || vc, loja: cod, venda: 0, pedidos: new Set(), itens: 0, devol: 0 };
      vend[kv].venda += v; if (l.tipo === "DEVOLUCAO") vend[kv].devol += v; else { vend[kv].pedidos.add(l.pedido); vend[kv].itens += q; }
      const [pc, ...pn] = limpa(l.produto).split(" - ");
      const kp = `${pc}|${cod}`;
      prod[kp] ??= { cod: pc, nome: pn.join(" - ") || pc, grupo: limpa(l.grupo).replace(/^\d+ - /, ""), marca: limpa(l.marca), loja: cod, qtd: 0, valor: 0 };
      prod[kp].qtd += q; prod[kp].valor += v;
      const g = limpa(l.grupo).replace(/^\d+ - /, "") || "Outros";
      grupos[g] = (grupos[g] || 0) + v;
      const m = limpa(l.marca) || "Sem marca";
      marcas[m] = (marcas[m] || 0) + v;
    }
    return {
      bruto: r2(bruto), devolucoes: r2(devol), liquido: r2(bruto + devol), pedidos: pedidos.size, pedidosPorLoja: pedLoja,
      vendedores: Object.values(vend).map((x) => ({ ...x, venda: r2(x.venda), devol: r2(x.devol), pedidos: x.pedidos.size })).filter((x) => x.venda || x.devol).sort((a, b) => b.venda - a.venda),
      produtos: Object.values(prod).map((x) => ({ ...x, valor: r2(x.valor) })).filter((x) => x.valor || x.qtd).sort((a, b) => b.valor - a.valor),
      grupos: Object.entries(grupos).map(([nome, valor]) => ({ nome, valor: r2(valor) })).sort((a, b) => b.valor - a.valor),
      marcas: Object.entries(marcas).map(([nome, valor]) => ({ nome, valor: r2(valor) })).sort((a, b) => b.valor - a.valor),
    };
  }

  // venda líquida por dia (para o gráfico acumulado)
  const porDia = (linhas, nDias) => {
    const a = Array(nDias).fill(0);
    for (const l of linhas || []) { const d = dia(l.data); if (d >= 1 && d <= nDias) a[d - 1] += l.valorTotal || 0; }
    return a.map(r2);
  };

  const p = raw.periodos;
  const periodo = (k, linhas) => ({ ...p[k], resumo: resumo(raw.resumo[k]), ...itens(linhas, p[k].inicio, p[k].fim) });
  const out = {
    geradoEm: raw.agora,
    lojas,
    periodos: {
      hoje: periodo("hoje", raw.dados.atual),
      ontem: periodo("ontem", p.ontem.inicio.slice(0, 7) === p.hoje.inicio.slice(0, 7) ? raw.dados.atual : raw.dados.anterior),
      mes: periodo("mes", raw.dados.atual),
      mesAnt: periodo("mesAnt", raw.dados.anterior),
    },
    comparativos: p.mesAntParcial ? (() => {
      const a = itens(raw.dados.atual, p.mesAteOntem.inicio, p.mesAteOntem.fim);
      const b = itens(raw.dados.anterior, p.mesAntParcial.inicio, p.mesAntParcial.fim);
      const ra = resumo(raw.resumo.mesAteOntem), rb = resumo(raw.resumo.mesAntParcial);
      const lojasDe = (r) => Object.fromEntries((r?.lojas || []).map((l) => [l.cod, l.venda]));
      return {
        ateDia: Number(p.mesAntParcial.fim.slice(8)),
        atual: { ...(ra?.geral || {}), pedidos: a.pedidos },
        anterior: { ...(rb?.geral || {}), pedidos: b.pedidos },
        lojasAtual: lojasDe(ra), lojasAnterior: lojasDe(rb),
      };
    })() : null,
    diario: { atual: porDia(raw.dados.atual, raw.diasMesAtual), anterior: porDia(raw.dados.anterior, raw.diasMesAnterior) },
    leads: {
      hoje: raw.leads.hoje ? { ...raw.leads.hoje.cards, porLoja: (raw.leads.hoje.resumoPorLoja || []).map((l) => ({ nome: limpa(l.nome), num: Number(l.extra) || 0, regional: l.regional, contatos: l.contatos, convertidos: l.convertidos, valor: l.valor, taxa: l.taxaConversao })) } : null,
      mes: raw.leads.mes ? { ...raw.leads.mes.cards, porLoja: (raw.leads.mes.resumoPorLoja || []).map((l) => ({ nome: limpa(l.nome), num: Number(l.extra) || 0, regional: l.regional, contatos: l.contatos, convertidos: l.convertidos, valor: l.valor, taxa: l.taxaConversao })) } : null,
    },
  };
  // só as lojas que aparecem em algum período
  const usadas = new Set();
  for (const x of Object.values(out.periodos)) { for (const l of x.resumo?.lojas || []) if (l.venda || l.meta) usadas.add(l.cod); for (const v of x.vendedores) usadas.add(v.loja); }
  for (const c of Object.keys(lojas)) if (!usadas.has(c)) delete lojas[c];
  // pedidos/ticket por período
  for (const k in out.periodos) {
    const x = out.periodos[k];
    x.ticket = x.pedidos ? r2(x.bruto / x.pedidos) : 0;
  }
  return out;
}

// períodos em horário de Salvador
function periodosPainel(agoraMs = Date.now()) {
  const hoje = new Date(agoraMs - 3 * 3600e3).toISOString().slice(0, 10);
  const [Y, M, D] = hoje.split("-").map(Number);
  const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  const diasNo = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ontem = iso(Y, M, D - 1);
  const [aY, aM] = M === 1 ? [Y - 1, 12] : [Y, M - 1];
  const nomes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return {
    hoje: { label: "Hoje", inicio: hoje, fim: hoje },
    ontem: { label: "Ontem", inicio: ontem, fim: ontem },
    mes: { label: nomes[M - 1], inicio: iso(Y, M, 1), fim: hoje },
    mesAnt: { label: nomes[aM - 1], inicio: iso(aY, aM, 1), fim: iso(aY, aM, diasNo(aY, aM)) },
    // comparação justa: dias fechados (dia 1 até ontem) x mesmos dias do mês anterior
    mesAteOntem: D > 1 ? { inicio: iso(Y, M, 1), fim: ontem } : null,
    mesAntParcial: D > 1 ? { inicio: iso(aY, aM, 1), fim: iso(aY, aM, Math.min(D - 1, diasNo(aY, aM))) } : null,
    diasMesAtual: diasNo(Y, M), diasMesAnterior: diasNo(aY, aM),
  };
}

if (typeof module !== "undefined") module.exports = { agregarPainel, periodosPainel };
if (typeof window !== "undefined") Object.assign(window, { agregarPainel, periodosPainel });
