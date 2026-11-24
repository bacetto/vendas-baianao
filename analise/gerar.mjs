// Análise diária de vendas (roda 00:05 de Salvador, depois que as lojas fecharam).
// Entrada: saida/dados.json (o mesmo formato do painel) e, se tiver, saida/raw.json (respostas do portal).
// Saída: análise do mês até ontem (dias fechados) — pontos fracos, pontos fortes, plano de ação,
// regionais, lojas e vendedores. Só números agregados (nada de cliente/CPF/pedido).
// Uso: node analise/gerar.mjs saida/dados.json saida/raw.json saida/analise.json
import fs from "node:fs";

const [, , ARQ_DADOS, ARQ_RAW, ARQ_SAIDA] = process.argv;
const D = JSON.parse(fs.readFileSync(ARQ_DADOS, "utf8"));
let RAW = null;
try { RAW = JSON.parse(fs.readFileSync(ARQ_RAW, "utf8")); } catch (e) {}

const LIDER = { R1: "UARA", R2: "DIEGO", R3: "ALEXANDRE", R4: "MICHEL" };
const REGS = ["R1", "R2", "R3", "R4"];
const r2 = (x) => Math.round((x || 0) * 100) / 100;
const r4 = (x) => Math.round((x || 0) * 10000) / 10000;
const div = (a, b) => (b ? a / b : 0);
const limpa = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const soma = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const mediana = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return 0; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const brl = (v) => "R$ " + Math.round(v || 0).toLocaleString("pt-BR");
const mil = (v) => { const a = Math.abs(v || 0); return (v < 0 ? "-" : "") + (a >= 1e6 ? "R$ " + (a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " mi" : a >= 1e3 ? "R$ " + (a / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " mil" : brl(a)); };
const pc = (v, d = 0) => ((v || 0) * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
const pp = (v) => (Math.round((v || 0) * 1000) / 10).toLocaleString("pt-BR") + " p.p.";

// ---------- período base: mês até ontem (dias fechados); no dia 1, o mês anterior fechado ----------
const P = D.periodos;
const fechado = !P.mesAteOntem;
const B = fechado ? P.mesAnt : P.mesAteOntem;
const resKey = fechado ? "mesAnt" : "mesAteOntem";
const diasPassados = Number(B.fim.slice(8));
const diasMes = fechado ? new Date(Date.UTC(+B.inicio.slice(0, 4), +B.inicio.slice(5, 7), 0)).getUTCDate() : (RAW?.diasMesAtual || D.diario?.atual?.length || 30);
const diasRestantes = fechado ? 0 : diasMes - diasPassados;
const mesLabel = (fechado ? P.mesAnt.label : P.mes.label) || "";
const R = B.resumo || { geral: {}, regionais: [], lojas: [], categorias: [] };
const C = fechado ? null : D.comparativos;              // mesmos dias do mês anterior
const Z = D.zep?.periodos ? (fechado ? D.zep.periodos.mesAnt : D.zep.periodos.mesF) : null; // BaianãoEletro (ZepSystem)

// meta do mês inteiro (por loja, regional e rede) — vem do portal (raw.resumo.mesCheio)
const metaMes = { rede: 0, reg: {}, loja: {} };
if (fechado) {
  metaMes.rede = R.geral?.meta || 0;
  for (const r of R.regionais || []) metaMes.reg[r.reg] = r.meta;
  for (const l of R.lojas || []) metaMes.loja[l.cod] = l.meta;
} else if (RAW?.resumo?.mesCheio?.geral) {
  const mc = RAW.resumo.mesCheio;
  metaMes.rede = mc.geral?.mercantil?.meta || 0;
  for (const r of mc.porRegional || []) metaMes.reg[r.regional] = r.mercantil?.meta || 0;
  for (const l of mc.porLoja || []) metaMes.loja[limpa(l.filial || l.loja)] = l.mercantil?.meta || 0;
} else {
  // sem o raw: estima pela meta até ontem proporcional aos dias
  const f = div(diasMes, diasPassados);
  metaMes.rede = (R.geral?.meta || 0) * f;
  for (const r of R.regionais || []) metaMes.reg[r.reg] = r.meta * f;
  for (const l of R.lojas || []) metaMes.loja[l.cod] = l.meta * f;
}

// categorias por loja (meta x venda) — do raw
const catLoja = {};
const resRaw = RAW?.resumo?.[resKey];
if (resRaw?.porLoja) {
  const nomes = Object.fromEntries((resRaw.categorias || []).map((c) => [c.codigo, limpa(c.descricao)]));
  for (const l of resRaw.porLoja) {
    const cod = limpa(l.filial || l.loja);
    catLoja[cod] = (l.porCategoria || []).map((c) => ({ nome: nomes[c.codigo] || String(c.codigo), venda: c.venda || 0, meta: c.meta || 0 })).filter((c) => c.meta > 0);
  }
}

// ---------- vendedores, pedidos, devoluções por loja ----------
const vendedores = (B.vendedores || []).filter((v) => /^001\d{4}$/.test(v.loja));
const porLojaV = {};
for (const v of vendedores) (porLojaV[v.loja] ||= []).push(v);
const pedidosLoja = B.pedidosPorLoja || {};

// leads do mês (o portal dá do mês corrente; no dia 1 não há leads do mês anterior)
const leadsLoja = {};
if (!fechado) for (const l of D.leads?.mes?.porLoja || []) { const cod = `001${String(l.num).padStart(4, "0")}`; leadsLoja[cod] = { contatos: l.contatos || 0, convertidos: l.convertidos || 0, valor: l.valor || 0 }; }

const zepLoja = Object.fromEntries((Z?.lojas || []).map((l) => [l.cod, l]));
const nomeLoja = (cod) => { const l = D.lojas?.[cod]; return l ? `${String(l.num).padStart(2, "0")} · ${l.nome || "Loja " + l.num}` : cod; };
const regDe = (cod) => D.lojas?.[cod]?.regional || "Sem regional";

// ---------- indicadores de uma unidade (rede / regional / loja) ----------
function indicadores(o) {
  const venda = o.venda || 0, meta = o.meta || 0, mm = o.metaMes || 0;
  const pct = div(venda, meta);
  const projetado = fechado ? venda : venda + Math.max(0, mm - meta) * Math.min(pct, 1.6); // segue no ritmo atual da meta
  const serv = (o.garantia || 0) + (o.pacote || 0);
  return {
    venda: r2(venda), meta: r2(meta), pct: r4(pct), falta: r2(Math.max(0, meta - venda)),
    metaMes: r2(mm), projetado: r2(projetado), projPct: r4(div(projetado, mm)),
    mediaDia: r2(div(venda, diasPassados)),
    precisaDia: diasRestantes > 0 ? r2(Math.max(0, mm - venda) / diasRestantes) : 0,
    margem: r4(o.margem || 0), lucro: r2(o.lucro || 0),
    garantia: r2(o.garantia), pacote: r2(o.pacote), servPct: r4(div(serv, venda)),
    sorteQtd: o.sorteQtd || 0,
    pedidos: o.pedidos || 0, ticket: r2(div(o.bruto || 0, o.pedidos || 0)), pa: r2(div(o.itens || 0, o.pedidos || 0)),
    devolPct: r4(div(Math.abs(o.devol || 0), o.bruto || 0)),
    anterior: o.anterior == null ? null : r2(o.anterior), cresc: o.anterior ? r4(div(venda, o.anterior) - 1) : null,
    leads: o.leads ? { contatos: o.leads.contatos, convertidos: o.leads.convertidos, taxa: r4(div(o.leads.convertidos, o.leads.contatos)), valor: r2(o.leads.valor) } : null,
    eletro: o.eletro ? { venda: r2(o.eletro.venda), pedidos: o.eletro.pedidos || 0 } : null,
  };
}

// ---------- lojas ----------
const lojas = [];
for (const l of R.lojas || []) {
  const reg = regDe(l.cod);
  if (!/^R[1-4]$/.test(reg)) continue;            // R0 e "Sem regional" não entram nos rankings
  if (!(l.meta > 0) && !(l.venda > 0)) continue;
  const vs = porLojaV[l.cod] || [];
  const bruto = soma(vs, (v) => v.venda - (v.devol || 0));
  const devol = soma(vs, (v) => v.devol);
  const itensQ = soma(vs, (v) => v.itens);
  const ld = leadsLoja[l.cod];
  const ind = indicadores({ ...l, metaMes: metaMes.loja[l.cod] || l.meta, bruto, devol, itens: itensQ, pedidos: pedidosLoja[l.cod] || soma(vs, (v) => v.pedidos),
    anterior: C?.lojasAnterior?.[l.cod] ?? null, leads: ld && ld.contatos ? ld : null, eletro: zepLoja[l.cod] || null });
  // vendedores da loja
  const vOrd = vs.filter((v) => v.venda > 0).sort((a, b) => b.venda - a.venda);
  const totV = soma(vOrd, (v) => v.venda);
  const cats = (catLoja[l.cod] || []).map((c) => ({ ...c, pct: div(c.venda, c.meta) })).sort((a, b) => a.pct - b.pct);
  lojas.push({ cod: l.cod, num: D.lojas?.[l.cod]?.num || 0, nome: nomeLoja(l.cod), reg, lider: LIDER[reg], ...ind,
    nVend: vOrd.length, topVend: vOrd[0] ? { nome: limpa(vOrd[0].nome), venda: r2(vOrd[0].venda), share: r4(div(vOrd[0].venda, totV)) } : null,
    catPior: cats[0] && cats[0].meta > 3000 ? { nome: cats[0].nome, pct: r4(cats[0].pct), falta: r2(cats[0].meta - cats[0].venda) } : null,
    catMelhor: cats.length ? (() => { const c = cats[cats.length - 1]; return c.meta > 3000 ? { nome: c.nome, pct: r4(c.pct) } : null; })() : null });
}

// referência da rede (mediana das lojas, mais justa que média com loja gigante)
const REF = {
  margem: mediana(lojas.map((l) => l.margem)), servPct: mediana(lojas.map((l) => l.servPct)),
  ticket: mediana(lojas.filter((l) => l.pedidos).map((l) => l.ticket)), pa: mediana(lojas.filter((l) => l.pedidos).map((l) => l.pa)),
  devolPct: mediana(lojas.map((l) => l.devolPct)), taxaLeads: mediana(lojas.filter((l) => l.leads?.contatos >= 20).map((l) => l.leads.taxa)),
  cresc: mediana(lojas.filter((l) => l.cresc != null).map((l) => l.cresc)),
};

// ---------- diagnóstico por loja: pontos fracos, fortes e ações ----------
const TIPOS = {
  meta: { titulo: "Abaixo da meta", acao: "Plano de recuperação com o gerente: meta diária por vendedor e acompanhamento no fim de cada dia" },
  queda: { titulo: "Vendendo menos que no mês passado", acao: "Entender o que mudou (equipe, estoque, fluxo de clientes) e reforçar ações de fluxo e leads" },
  margem: { titulo: "Margem baixa", acao: "Revisar descontos dados: treinar negociação e segurar desconto fora da regra" },
  servico: { titulo: "Pouco serviço (garantia + pacote)", acao: "Oferecer garantia e pacote em toda venda; meta diária de serviço por vendedor" },
  ticket: { titulo: "Ticket médio baixo", acao: "Trabalhar venda casada e produtos de maior valor (kit, upgrade de modelo)" },
  pa: { titulo: "Poucos itens por venda", acao: "Oferecer complemento em toda venda (base, travesseiro, suporte, acessório)" },
  leads: { titulo: "Converte pouco os leads", acao: "Responder o lead rápido (até 1h) e cobrar retorno de todos os contatos no CRM" },
  devol: { titulo: "Devolução alta", acao: "Levantar o motivo das devoluções (entrega, montagem, produto, venda mal feita) e corrigir" },
  depende: { titulo: "Depende de um só vendedor", acao: "Parear o melhor vendedor com o restante do time e redistribuir atendimento" },
  categoria: { titulo: "Categoria fraca", acao: "Reforçar exposição, preço e campanha da categoria com a equipe" },
};
for (const l of lojas) {
  const f = [], b = [];
  const metaRef = fechado ? l.pct : l.pct;
  if (metaRef < 0.95) f.push({ tipo: "meta", peso: l.falta, txt: `${pc(l.pct)} da meta até agora — faltam ${mil(l.falta)}` + (diasRestantes > 0 && l.precisaDia > l.mediaDia ? `; precisa vender ${mil(l.precisaDia)}/dia (vem fazendo ${mil(l.mediaDia)}/dia)` : "") });
  if (l.cresc != null && l.cresc < -0.08 && l.anterior > 0) f.push({ tipo: "queda", peso: l.anterior - l.venda, txt: `${pc(l.cresc)} em relação ao mesmo período do mês passado (${mil(l.anterior)} → ${mil(l.venda)})` });
  if (l.venda > 0 && l.margem < REF.margem - 0.025) f.push({ tipo: "margem", peso: (REF.margem - l.margem) * l.venda, txt: `margem ${pc(l.margem, 1)} (rede ${pc(REF.margem, 1)}) — ${pp(REF.margem - l.margem)} abaixo` });
  if (l.venda > 0 && REF.servPct > 0 && l.servPct < REF.servPct * 0.7) f.push({ tipo: "servico", peso: (REF.servPct - l.servPct) * l.venda, txt: `serviços ${pc(l.servPct, 1)} da venda (rede ${pc(REF.servPct, 1)})` });
  if (l.pedidos >= 10 && l.ticket < REF.ticket * 0.8) f.push({ tipo: "ticket", peso: (REF.ticket - l.ticket) * l.pedidos * 0.3, txt: `ticket ${brl(l.ticket)} (rede ${brl(REF.ticket)})` });
  if (l.pedidos >= 10 && l.pa < REF.pa * 0.85) f.push({ tipo: "pa", peso: (REF.pa - l.pa) * l.pedidos * 50, txt: `${l.pa.toLocaleString("pt-BR")} itens por venda (rede ${REF.pa.toLocaleString("pt-BR")})` });
  if (l.leads && l.leads.contatos >= 20 && REF.taxaLeads > 0 && l.leads.taxa < REF.taxaLeads * 0.7) f.push({ tipo: "leads", peso: (REF.taxaLeads - l.leads.taxa) * l.leads.contatos * (l.ticket || REF.ticket), txt: `converte ${pc(l.leads.taxa, 1)} dos leads (rede ${pc(REF.taxaLeads, 1)}) — ${l.leads.contatos} contatos` });
  if (l.devolPct > Math.max(0.04, REF.devolPct * 1.8)) f.push({ tipo: "devol", peso: l.devolPct * l.venda, txt: `devolução ${pc(l.devolPct, 1)} da venda (rede ${pc(REF.devolPct, 1)})` });
  if (l.topVend && l.nVend >= 3 && l.topVend.share > 0.45) f.push({ tipo: "depende", peso: l.venda * 0.05, txt: `${l.topVend.nome} faz ${pc(l.topVend.share)} da venda da loja` });
  if (l.catPior && l.catPior.pct < 0.7) f.push({ tipo: "categoria", peso: l.catPior.falta, txt: `${l.catPior.nome} em ${pc(l.catPior.pct)} da meta (faltam ${mil(l.catPior.falta)})` });

  if (l.pct >= 1.05) b.push({ tipo: "meta", txt: `${pc(l.pct)} da meta — acima do esperado` });
  else if (l.pct >= 1) b.push({ tipo: "meta", txt: `meta batida até agora (${pc(l.pct)})` });
  if (l.cresc != null && l.cresc > 0.1) b.push({ tipo: "cresc", txt: `crescendo ${pc(l.cresc)} sobre o mês passado` });
  if (l.venda > 0 && l.margem > REF.margem + 0.025) b.push({ tipo: "margem", txt: `margem ${pc(l.margem, 1)} (rede ${pc(REF.margem, 1)})` });
  if (l.venda > 0 && REF.servPct > 0 && l.servPct > REF.servPct * 1.3) b.push({ tipo: "servico", txt: `serviços ${pc(l.servPct, 1)} da venda (rede ${pc(REF.servPct, 1)})` });
  if (l.pedidos >= 10 && l.ticket > REF.ticket * 1.2) b.push({ tipo: "ticket", txt: `ticket ${brl(l.ticket)} (rede ${brl(REF.ticket)})` });
  if (l.leads && l.leads.contatos >= 20 && REF.taxaLeads > 0 && l.leads.taxa > REF.taxaLeads * 1.3) b.push({ tipo: "leads", txt: `converte ${pc(l.leads.taxa, 1)} dos leads (rede ${pc(REF.taxaLeads, 1)})` });
  if (l.catMelhor && l.catMelhor.pct >= 1.1) b.push({ tipo: "categoria", txt: `${l.catMelhor.nome} em ${pc(l.catMelhor.pct)} da meta` });

  f.sort((x, y) => y.peso - x.peso);
  l.fracos = f.map(({ tipo, txt }) => ({ tipo, titulo: TIPOS[tipo].titulo, txt }));
  l.fortes = b;
  l.acoes = f.slice(0, 3).map((x) => TIPOS[x.tipo].acao);
  const ref = fechado ? l.pct : l.projPct || l.pct;
  l.status = ref >= 1 ? "ok" : ref >= 0.9 ? "perto" : ref >= 0.8 ? "atencao" : "critica";
}
const ordemStatus = { critica: 0, atencao: 1, perto: 2, ok: 3 };

// ---------- regionais ----------
const regionais = REGS.map((reg) => {
  const r = (R.regionais || []).find((x) => x.reg === reg) || {};
  const ls = lojas.filter((l) => l.reg === reg);
  const vs = vendedores.filter((v) => regDe(v.loja) === reg);
  const bruto = soma(vs, (v) => v.venda - (v.devol || 0));
  const ld = { contatos: soma(ls, (l) => l.leads?.contatos), convertidos: soma(ls, (l) => l.leads?.convertidos), valor: soma(ls, (l) => l.leads?.valor) };
  const ant = C ? soma(Object.keys(C.lojasAnterior || {}).filter((c) => regDe(c) === reg), (c) => C.lojasAnterior[c]) : null;
  const ze = Z ? { venda: soma(ls, (l) => l.eletro?.venda), pedidos: soma(ls, (l) => l.eletro?.pedidos) } : null;
  const ind = indicadores({ ...r, metaMes: metaMes.reg[reg] || r.meta, bruto, devol: soma(vs, (v) => v.devol), itens: soma(vs, (v) => v.itens),
    pedidos: soma(ls, (l) => l.pedidos), anterior: ant || null, leads: ld.contatos ? ld : null, eletro: ze });
  const cont = (tipo) => ls.filter((l) => l.fracos.some((f) => f.tipo === tipo));
  const fracos = Object.keys(TIPOS).map((tipo) => ({ tipo, titulo: TIPOS[tipo].titulo, lojas: cont(tipo).map((l) => l.cod) })).filter((x) => x.lojas.length).sort((a, b) => b.lojas.length - a.lojas.length);
  return { reg, lider: LIDER[reg], ...ind, nLojas: ls.length,
    status: { critica: ls.filter((l) => l.status === "critica").length, atencao: ls.filter((l) => l.status === "atencao").length, perto: ls.filter((l) => l.status === "perto").length, ok: ls.filter((l) => l.status === "ok").length },
    melhores: [...ls].sort((a, b) => b.pct - a.pct).slice(0, 3).map((l) => l.cod),
    piores: [...ls].sort((a, b) => a.pct - b.pct).slice(0, 3).map((l) => l.cod),
    fracos };
});

// ---------- rede ----------
const g = R.geral || {};
const brutoRede = soma(vendedores, (v) => v.venda - (v.devol || 0));
const ldRede = { contatos: soma(lojas, (l) => l.leads?.contatos), convertidos: soma(lojas, (l) => l.leads?.convertidos), valor: soma(lojas, (l) => l.leads?.valor) };
const rede = { ...indicadores({ ...g, metaMes: metaMes.rede || g.meta, bruto: brutoRede, devol: soma(vendedores, (v) => v.devol), itens: soma(vendedores, (v) => v.itens),
  pedidos: B.pedidos || 0, anterior: C?.anterior?.venda || null, leads: ldRede.contatos ? ldRede : null,
  eletro: Z ? { venda: Z.vendido || 0, pedidos: Z.pedidos || 0 } : null }),
  eletroCancel: Z ? r4(Z.taxaCancelamento || 0) : null, eletroPerdidos: Z?.criterio === "confirmado" ? { clientes: Z.clientesPerdidos || 0, valor: r2(Z.valorPerdido), aguardando: r2(Z.aguardando) } : null, ref: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, r4(v)])),
  status: { critica: lojas.filter((l) => l.status === "critica").length, atencao: lojas.filter((l) => l.status === "atencao").length, perto: lojas.filter((l) => l.status === "perto").length, ok: lojas.filter((l) => l.status === "ok").length },
  nLojas: lojas.length, nVend: new Set(vendedores.filter((v) => v.venda > 0).map((v) => v.cod)).size };

// ---------- vendedores ----------
const vendList = vendedores.filter((v) => v.venda > 0 && /^R[1-4]$/.test(regDe(v.loja))).map((v) => {
  const bruto = v.venda - (v.devol || 0);
  return { nome: limpa(v.nome), loja: v.loja, lojaNome: nomeLoja(v.loja), reg: regDe(v.loja), venda: r2(v.venda), pedidos: v.pedidos || 0,
    ticket: r2(div(bruto, v.pedidos)), pa: r2(div(v.itens, v.pedidos)), devolPct: r4(div(Math.abs(v.devol || 0), bruto)) };
}).sort((a, b) => b.venda - a.venda);
vendList.forEach((v, i) => { v.rank = i + 1; });
const medLoja = {};
for (const cod in porLojaV) medLoja[cod] = mediana(porLojaV[cod].filter((v) => v.venda > 0).map((v) => v.venda));
const medVend = mediana(vendList.map((v) => v.venda));
const apoio = vendList.filter((v) => (porLojaV[v.loja] || []).length >= 3 && v.venda < medLoja[v.loja] * 0.4 && v.pedidos >= 2)
  .map((v) => ({ ...v, medLoja: r2(medLoja[v.loja]), motivo: v.ticket < REF.ticket * 0.7 ? "ticket baixo" : v.pa < REF.pa * 0.8 ? "poucos itens por venda" : "pouco volume de vendas" }))
  .sort((a, b) => div(a.venda, a.medLoja) - div(b.venda, b.medLoja)).slice(0, 25);
const destaqueTicket = vendList.filter((v) => v.pedidos >= 8).sort((a, b) => b.ticket - a.ticket).slice(0, 5);
const destaquePA = vendList.filter((v) => v.pedidos >= 8).sort((a, b) => b.pa - a.pa).slice(0, 5);

// ---------- categorias, grupos, produtos ----------
const categorias = (R.categorias || []).map((c) => ({ nome: c.nome, venda: r2(c.venda), meta: r2(c.meta), pct: r4(div(c.venda, c.meta)) })).filter((c) => c.meta > 0).sort((a, b) => a.pct - b.pct);
const totG = soma(B.grupos || [], (x) => x.valor), ant = fechado ? null : P.mesAnt, totGA = ant ? soma(ant.grupos || [], (x) => x.valor) : 0;
const gruposAnt = Object.fromEntries((ant?.grupos || []).map((x) => [x.nome, x.valor]));
const grupos = (B.grupos || []).filter((x) => x.valor > 0).slice(0, 15).map((x) => ({ nome: x.nome, valor: r2(x.valor), share: r4(div(x.valor, totG)), shareAnt: totGA ? r4(div(gruposAnt[x.nome] || 0, totGA)) : null }));
const prodAgg = {};
for (const p of B.produtos || []) { prodAgg[p.cod] ??= { cod: p.cod, nome: limpa(p.nome), grupo: p.grupo, qtd: 0, valor: 0, lojas: 0 }; prodAgg[p.cod].qtd += p.qtd; prodAgg[p.cod].valor += p.valor; prodAgg[p.cod].lojas++; }
const produtos = Object.values(prodAgg).sort((a, b) => b.valor - a.valor).slice(0, 20).map((p) => ({ ...p, valor: r2(p.valor) }));

// ---------- dia da semana ----------
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const vendaDia = (fechado ? D.diario?.anterior : D.diario?.atual) || [];
const metaAc = fechado ? null : D.diario?.metaAtual;
const semana = NOMES_DIA.map((nome) => ({ nome, dias: 0, venda: 0, meta: 0 }));
const dias = [];
for (let d = 1; d <= diasPassados; d++) {
  const dt = new Date(Date.UTC(+B.inicio.slice(0, 4), +B.inicio.slice(5, 7) - 1, d)), w = dt.getUTCDay();
  const v = vendaDia[d - 1] || 0, m = metaAc ? (metaAc[d - 1] || 0) - (d > 1 ? metaAc[d - 2] || 0 : 0) : 0;
  semana[w].dias++; semana[w].venda += v; semana[w].meta += m;
  dias.push({ d, w, venda: r2(v), meta: r2(m) });
}
const semanaOut = semana.filter((s) => s.dias).map((s) => ({ nome: s.nome, dias: s.dias, media: r2(s.venda / s.dias), pct: s.meta ? r4(s.venda / s.meta) : null }));

// ---------- pontos fracos e fortes da rede + plano de ação ----------
const L = (cods) => cods.map((c) => lojas.find((l) => l.cod === c)).filter(Boolean);
const lojasCom = (tipo) => lojas.filter((l) => l.fracos.some((f) => f.tipo === tipo));
const fracos = [], fortes = [];
if (rede.pct < 1) fracos.push({ nivel: rede.pct < 0.9 ? "alto" : "medio", titulo: `Rede em ${pc(rede.pct)} da meta`, txt: `Faltam ${mil(rede.falta)} pra estar em dia com a meta.` + (diasRestantes > 0 ? ` Pra fechar o mês precisa de ${mil(rede.precisaDia)}/dia (vem fazendo ${mil(rede.mediaDia)}/dia). No ritmo atual, fecha em ${pc(rede.projPct)} da meta do mês.` : "") });
else fortes.push({ titulo: `Rede em ${pc(rede.pct)} da meta`, txt: diasRestantes > 0 ? `No ritmo atual fecha o mês em ${pc(rede.projPct)} da meta (${mil(rede.projetado)}).` : "Meta do mês batida." });
if (rede.cresc != null) (rede.cresc < 0 ? fracos : fortes).push({ nivel: rede.cresc < -0.05 ? "alto" : "medio", titulo: `${rede.cresc < 0 ? "Vendendo menos" : "Vendendo mais"} que no mês passado: ${rede.cresc > 0 ? "+" : ""}${pc(rede.cresc, 1)}`, txt: `${mil(rede.venda)} contra ${mil(rede.anterior)} nos mesmos ${diasPassados} dias do mês passado.` });
const regPior = [...regionais].sort((a, b) => a.pct - b.pct)[0], regMelhor = [...regionais].sort((a, b) => b.pct - a.pct)[0];
if (regPior && regPior.pct < 0.95) fracos.push({ nivel: regPior.pct < 0.85 ? "alto" : "medio", titulo: `${regPior.reg} (${regPior.lider}) é a regional mais atrasada: ${pc(regPior.pct)}`, txt: `${regPior.status.critica} loja(s) crítica(s) e ${regPior.status.atencao} em atenção. Faltam ${mil(regPior.falta)}.` });
if (regMelhor && regMelhor.pct >= 0.95) fortes.push({ titulo: `${regMelhor.reg} (${regMelhor.lider}) lidera: ${pc(regMelhor.pct)} da meta`, txt: `${regMelhor.status.ok} de ${regMelhor.nLojas} lojas no ritmo da meta.` });
const crit = lojas.filter((l) => l.status === "critica");
if (crit.length) fracos.push({ nivel: "alto", titulo: `${crit.length} loja(s) em situação crítica (abaixo de 80%)`, txt: crit.sort((a, b) => a.pct - b.pct).slice(0, 8).map((l) => `${l.nome} (${pc(l.pct)})`).join(", ") + (crit.length > 8 ? "…" : "") });
const nServ = lojasCom("servico"), nMarg = lojasCom("margem"), nLeads = lojasCom("leads"), nQueda = lojasCom("queda"), nDev = lojasCom("devol"), nTicket = lojasCom("ticket"), nPA = lojasCom("pa"), nCat = lojasCom("categoria");
if (nServ.length >= 3) fracos.push({ nivel: "medio", titulo: `Serviço fraco em ${nServ.length} lojas`, txt: `Garantia + pacote abaixo de ${pc(REF.servPct * 0.7, 1)} da venda (rede ${pc(REF.servPct, 1)}). Serviço é margem quase pura.` });
if (nMarg.length >= 3) fracos.push({ nivel: "medio", titulo: `Margem baixa em ${nMarg.length} lojas`, txt: `Margem mais de 2,5 p.p. abaixo da mediana da rede (${pc(REF.margem, 1)}) — sinal de desconto alto.` });
if (nLeads.length >= 3) fracos.push({ nivel: "medio", titulo: `${nLeads.length} lojas convertem pouco os leads`, txt: `Conversão abaixo de ${pc(REF.taxaLeads * 0.7, 1)} (rede ${pc(REF.taxaLeads, 1)}). Lead é cliente que já procurou a loja.` });
if (nQueda.length >= 3) fracos.push({ nivel: "medio", titulo: `${nQueda.length} lojas vendendo menos que no mês passado`, txt: nQueda.sort((a, b) => a.cresc - b.cresc).slice(0, 6).map((l) => `${l.nome} (${pc(l.cresc)})`).join(", ") });
if (nDev.length) fracos.push({ nivel: "baixo", titulo: `Devolução alta em ${nDev.length} loja(s)`, txt: nDev.map((l) => `${l.nome} (${pc(l.devolPct, 1)})`).join(", ") });
const catFraca = categorias.filter((c) => c.pct < 0.85 && c.meta > 20000).slice(0, 3);
if (catFraca.length) fracos.push({ nivel: "medio", titulo: `Categorias atrás da meta: ${catFraca.map((c) => c.nome).join(", ")}`, txt: catFraca.map((c) => `${c.nome} ${pc(c.pct)} (faltam ${mil(c.meta - c.venda)})`).join(" · ") });
const catForte = [...categorias].reverse().filter((c) => c.pct >= 1.05 && c.meta > 20000).slice(0, 3);
if (catForte.length) fortes.push({ titulo: `Categorias puxando a venda: ${catForte.map((c) => c.nome).join(", ")}`, txt: catForte.map((c) => `${c.nome} ${pc(c.pct)}`).join(" · ") });
const top = [...lojas].sort((a, b) => b.pct - a.pct).slice(0, 5);
if (top.length) fortes.push({ titulo: "Lojas destaque (maior % da meta)", txt: top.map((l) => `${l.nome} (${pc(l.pct)})`).join(", ") });
const cresceu = lojas.filter((l) => l.cresc != null && l.cresc > 0.1).sort((a, b) => b.cresc - a.cresc).slice(0, 5);
if (cresceu.length) fortes.push({ titulo: "Lojas que mais cresceram sobre o mês passado", txt: cresceu.map((l) => `${l.nome} (+${pc(l.cresc)})`).join(", ") });
if (rede.eletroPerdidos?.clientes) fracos.push({ nivel: "medio", titulo: `Baianão Eletro: ${rede.eletroPerdidos.clientes} clientes não finalizaram a compra (${mil(rede.eletroPerdidos.valor)})`, txt: `Pedidos cancelados sem nenhuma compra depois — a maioria no cartão de crédito. A lista pra recuperar está no painel de vendas, aba BaianãoEletro.` });
if (vendList[0]) fortes.push({ titulo: "Vendedores destaque da rede", txt: vendList.slice(0, 5).map((v) => `${v.nome} — ${v.lojaNome} (${mil(v.venda)})`).join(" · ") });
const servBom = lojas.filter((l) => l.fortes.some((f) => f.tipo === "servico")).sort((a, b) => b.servPct - a.servPct).slice(0, 4);
if (servBom.length) fortes.push({ titulo: "Referência em serviço (copiar o jeito dessas lojas)", txt: servBom.map((l) => `${l.nome} (${pc(l.servPct, 1)})`).join(", ") });
const semOrd = semanaOut.filter((s) => s.pct != null).sort((a, b) => a.pct - b.pct);
if (semOrd.length >= 3 && semOrd[0].pct < 0.9) fracos.push({ nivel: "baixo", titulo: `${semOrd[0].nome[0].toUpperCase() + semOrd[0].nome.slice(1)} é o dia mais fraco da semana (${pc(semOrd[0].pct)} da meta)`, txt: `Bom dia pra ação de fluxo/oferta. Melhor dia: ${semOrd[semOrd.length - 1].nome} (${pc(semOrd[semOrd.length - 1].pct)}).` });

// plano de ação priorizado
const plano = [];
const cod2 = (ls) => ls.map((l) => l.nome);
const porReg = (ls) => REGS.map((r) => ({ reg: r, lider: LIDER[r], lojas: ls.filter((l) => l.reg === r) })).filter((x) => x.lojas.length);
if (crit.length) for (const x of porReg(crit)) plano.push({ prioridade: 1, area: "Meta", oque: `Recuperar as lojas críticas da ${x.reg}`, onde: cod2(x.lojas), quem: `${x.lider} (líder ${x.reg}) + gerentes`, como: "Reunião rápida com cada gerente, meta diária por vendedor, ação de fluxo (leads, carro de som, ofertas) e acompanhar todo fim de dia", indicador: "% da meta subir pra pelo menos 90%", prazo: "Esta semana" });
if (!fechado && rede.precisaDia > rede.mediaDia) plano.push({ prioridade: 1, area: "Meta", oque: `Rede precisa vender ${mil(rede.precisaDia)}/dia até o fim do mês`, onde: ["Rede toda"], quem: "Diretoria + líderes regionais", como: `Hoje a média é ${mil(rede.mediaDia)}/dia. Dividir a diferença por regional/loja e cobrar diariamente.`, indicador: "Venda diária ≥ necessário", prazo: `Até dia ${diasMes}` });
if (nServ.length) plano.push({ prioridade: 2, area: "Serviços", oque: "Aumentar garantia e pacote de serviços", onde: cod2(nServ.sort((a, b) => a.servPct - b.servPct).slice(0, 10)), quem: "Líderes regionais + gerentes", como: `Oferecer em toda venda; meta diária de serviço por vendedor; usar como exemplo ${servBom[0]?.nome || "as lojas com melhor serviço"}`, indicador: `Serviço ≥ ${pc(REF.servPct, 1)} da venda`, prazo: "15 dias" });
if (nMarg.length) plano.push({ prioridade: 2, area: "Margem", oque: "Segurar desconto e recuperar margem", onde: cod2(nMarg.sort((a, b) => a.margem - b.margem).slice(0, 10)), quem: "Líderes regionais + aprovação de descontos", como: "Revisar os maiores descontos do mês, treinar negociação, conferir se as aprovações seguem a regra", indicador: `Margem ≥ ${pc(REF.margem, 1)}`, prazo: "15 dias" });
if (nLeads.length) plano.push({ prioridade: 2, area: "Leads", oque: "Converter mais os leads", onde: cod2(nLeads.slice(0, 10)), quem: "Gerentes de loja", como: "Responder em até 1h, retorno em todos os contatos, conferir no CRM quem não foi atendido", indicador: `Conversão ≥ ${pc(REF.taxaLeads, 1)}`, prazo: "Esta semana" });
if (nQueda.length) plano.push({ prioridade: 2, area: "Crescimento", oque: "Entender a queda sobre o mês passado", onde: cod2(nQueda.slice(0, 10)), quem: "Líderes regionais", como: "Checar equipe (faltas, desligamentos), estoque/ruptura dos campeões de venda e fluxo de clientes", indicador: "Voltar ao nível do mês passado", prazo: "Esta semana" });
if (catFraca.length) plano.push({ prioridade: 2, area: "Categorias", oque: `Campanha para ${catFraca.map((c) => c.nome).join(", ")}`, onde: ["Rede toda"], quem: "Comercial / compras + marketing", como: "Revisar preço, estoque e exposição; oferta focada e meta da categoria por loja", indicador: "Categoria ≥ 95% da meta", prazo: "15 dias" });
if (nTicket.length + nPA.length) plano.push({ prioridade: 3, area: "Ticket", oque: "Aumentar ticket e itens por venda", onde: cod2([...new Set([...nTicket, ...nPA])].slice(0, 10)), quem: "Gerentes de loja", como: "Venda casada (kit), oferecer complemento em toda venda, upgrade de modelo", indicador: `Ticket ≥ ${brl(REF.ticket)} e ${REF.pa.toLocaleString("pt-BR")} itens por venda`, prazo: "30 dias" });
if (nDev.length) plano.push({ prioridade: 3, area: "Devoluções", oque: "Reduzir devoluções", onde: cod2(nDev), quem: "Gerentes + logística", como: "Levantar motivo de cada devolução do mês e corrigir a causa (entrega, montagem, venda mal explicada)", indicador: `Devolução ≤ ${pc(Math.max(0.03, REF.devolPct), 1)}`, prazo: "30 dias" });
if (apoio.length) plano.push({ prioridade: 3, area: "Equipe", oque: `Acompanhar ${apoio.length} vendedores bem abaixo do time da loja`, onde: [...new Set(apoio.map((v) => v.lojaNome))].slice(0, 10), quem: "Gerentes de loja", como: "Acompanhamento individual, parear com o melhor vendedor da loja, treinar produto e fechamento", indicador: "Chegar a pelo menos 70% da mediana da loja", prazo: "30 dias" });
plano.push({ prioridade: 3, area: "Reconhecimento", oque: "Reconhecer quem está puxando a rede", onde: [...top.slice(0, 3).map((l) => l.nome), ...vendList.slice(0, 3).map((v) => v.nome)], quem: "Diretoria", como: "Parabenizar no grupo, premiar e usar como exemplo pras outras lojas", indicador: "—", prazo: "Esta semana" });

// ---------- resumo executivo (texto simples) ----------
const resumoTxt = [];
resumoTxt.push(`${fechado ? "Mês fechado" : `Até ontem (dia ${diasPassados})`}, a rede vendeu ${mil(rede.venda)} — ${pc(rede.pct)} da meta${rede.cresc != null ? ` e ${rede.cresc >= 0 ? "+" : ""}${pc(rede.cresc, 1)} sobre o mesmo período do mês passado` : ""}.`);
if (!fechado) resumoTxt.push(`No ritmo atual, fecha ${mesLabel} em ${mil(rede.projetado)} (${pc(rede.projPct)} da meta). ${rede.precisaDia > rede.mediaDia ? `Pra bater, precisa de ${mil(rede.precisaDia)}/dia nos ${diasRestantes} dias que faltam.` : "Está no caminho pra bater a meta."}`);
resumoTxt.push(`${rede.status.ok} lojas no ritmo da meta, ${rede.status.perto} perto, ${rede.status.atencao} em atenção e ${rede.status.critica} críticas.`);
if (regMelhor && regPior) resumoTxt.push(`Melhor regional: ${regMelhor.reg} (${regMelhor.lider}) com ${pc(regMelhor.pct)}. Mais atrasada: ${regPior.reg} (${regPior.lider}) com ${pc(regPior.pct)}.`);

const out = {
  geradoEm: new Date().toISOString(), dadosDe: D.geradoEm, fonte: RAW ? "portal" : "painel",
  base: { mes: mesLabel, inicio: B.inicio, fim: B.fim, diasPassados, diasMes, diasRestantes, fechado },
  resumo: resumoTxt, rede, regionais, lojas: lojas.sort((a, b) => ordemStatus[a.status] - ordemStatus[b.status] || a.pct - b.pct),
  fracos, fortes, plano,
  vendedores: { top: vendList.slice(0, 30), apoio, destaqueTicket, destaquePA, total: vendList.length, mediana: r2(medVend) },
  categorias, grupos, produtos, semana: semanaOut, dias,
};
fs.writeFileSync(ARQ_SAIDA, JSON.stringify(out));
// registro público: só contagens
console.log(`✅ análise gerada (${out.fonte}): ${lojas.length} lojas | ${vendList.length} vendedores | ${plano.length} ações | base ${B.inicio}..${B.fim}`);
