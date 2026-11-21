// Analista de IA do painel: a cada ~30 min manda os números AGREGADOS (sem dado de cliente) pro Cloudflare Workers AI
// (plano grátis; a Cloudflare não usa os dados pra treinar) e guarda a análise em dados.ia.
// Precisa dos secrets CF_ACCOUNT_ID e CF_AI_TOKEN; sem eles, o painel usa o resumo automático.
import fs from "node:fs";

const CACHE = "saida/ia.json";
const MODELOS = ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
// valores já formatados em texto: o modelo só copia, não converte (evita "R$ 586 mil" virar "R$ 5,9 mi")
const r0 = (x) => { const v = Math.round(x || 0), a = Math.abs(v), f = (n, d) => n.toLocaleString("pt-BR", { maximumFractionDigits: d });
  return (v < 0 ? "-" : "") + (a >= 1e6 ? `R$ ${f(a / 1e6, 2)} mi` : a >= 1e3 ? `R$ ${f(a / 1e3, 1)} mil` : `R$ ${f(a, 0)}`); };
const p1 = (x) => `${(Math.round((x || 0) * 1000) / 10).toLocaleString("pt-BR")}%`;

function projecao(D, reg) {
  const d = Number(D.periodos.hoje.fim.slice(8)), c = D.comparativos, rc = D.regionaisComparativo;
  const serie = reg ? D.diario.porRegional?.[reg] : { atual: D.diario.atual, meta: D.diario.metaAtual };
  if (!rc || !serie?.meta?.length) return null;
  const soma = (a) => (a || []).reduce((s, x) => s + (x || 0), 0);
  const md = serie.meta.map((v, i) => (i ? v - serie.meta[i - 1] : v));
  const base = soma(D.diario.atual.slice(0, d - 1));
  const k = c && d > 1 && base ? c.atual.venda / base : 1;
  const ini = Math.max(0, d - 8), m7 = soma(md.slice(ini, d - 1));
  const efic = m7 ? (soma(serie.atual.slice(ini, d - 1)) * k) / m7 : null;
  const linha = reg ? rc.regionais.find((x) => x.reg === reg) : rc.rede;
  if (!linha || efic == null) return null;
  const hj = D.periodos.hoje.resumo, vh = (reg ? hj?.regionais?.find((x) => x.reg === reg)?.venda : hj?.geral?.venda) || 0;
  const ateOntem = d > 1 ? soma(serie.atual.slice(0, d - 1)) * k : 0;
  const metaMes = linha.metaMes || serie.meta.at(-1);
  const proj = ateOntem + Math.max(vh, (md[d - 1] || 0) * efic) + (metaMes - serie.meta[Math.min(d, serie.meta.length) - 1]) * efic;
  return { projecao: r0(proj), pctProjecao: p1(proj / metaMes), metaMes: r0(metaMes), eficiencia7dias: p1(efic), precisaPorDia: r0(Math.max(0, metaMes - linha.venda) / Math.max(1, serie.meta.length - d + 1)) };
}

// resumo compacto e só agregado pro modelo
function contexto(D) {
  const P = D.periodos, nome = (c) => { const l = D.lojas[c]; return l ? `${String(l.num).padStart(2, "0")} ${l.nome}` : c; };
  const g = (r) => r ? { venda: r0(r.venda), meta: r0(r.meta), pctMeta: p1(r.pct), margem: p1(r.margem) } : null;
  const lojas = (r) => (r?.lojas || []).filter((l) => l.meta > 0).map((l) => ({ loja: nome(l.cod), reg: D.lojas[l.cod]?.regional, venda: r0(l.venda), pctMeta: p1(l.pct), margem: p1(l.margem), _p: l.pct })).sort((a, b) => b._p - a._p).map(({ _p, ...x }) => x);
  const lm = lojas(P.mes.resumo), lh = lojas(P.hoje.resumo);
  const g7 = new Date(new Date(D.geradoEm).getTime() - 3 * 3600e3);
  const z = D.zep?.periodos;
  const zp = (x) => x ? { vendido: r0(x.vendido), pedidos: x.pedidos, ticket: r0(x.ticket), aguardando: r0(x.aguardando), cancelado: r0(x.cancelado), taxaCancelamento: p1(x.taxaCancelamento), topVendedores: x.vendedores.slice(0, 5).map((v) => ({ nome: v.nome, venda: r0(v.venda) })), pagamentos: x.pagamentos.map((p) => ({ nome: p.nome, valor: r0(p.valor) })) } : null;
  return {
    agora: `${String(g7.getUTCHours()).padStart(2, "0")}:${String(g7.getUTCMinutes()).padStart(2, "0")} de ${P.hoje.inicio.split("-").reverse().join("/")}`,
    universo: {
      hoje: g(P.hoje.resumo?.geral), ontem: g(P.ontem.resumo?.geral), mesAteHoje: g(P.mes.resumo?.geral),
      mesPassadoMesmoPeriodo: D.regionaisComparativo ? r0(D.regionaisComparativo.rede.anteriorMesmoPeriodo) : null,
      mesPassadoFechado: D.regionaisComparativo ? r0(D.regionaisComparativo.rede.anteriorFechado) : null,
      projecaoMes: projecao(D),
      regionais: (P.mes.resumo?.regionais || []).map((r) => ({ reg: r.reg, lider: r.lider, mes: g(r), hoje: g(P.hoje.resumo?.regionais?.find((x) => x.reg === r.reg)), projecao: projecao(D, r.reg) })),
      categoriasMes: (P.mes.resumo?.categorias || []).map((c) => ({ nome: c.nome, venda: r0(c.venda), pctMeta: c.meta ? p1(c.venda / c.meta) : "sem meta" })),
      lojasMes: { melhores: lm.slice(0, 6), piores: lm.slice(-8).reverse() },
      lojasHoje: { melhores: lh.slice(0, 5), piores: lh.slice(-5).reverse() },
      topVendedoresHoje: (P.hoje.vendedores || []).slice(0, 5).map((v) => ({ nome: v.nome, loja: nome(v.loja), venda: r0(v.venda) })),
      topVendedoresMes: (P.mes.vendedores || []).slice(0, 8).map((v) => ({ nome: v.nome, loja: nome(v.loja), venda: r0(v.venda) })),
      pedidosHoje: P.hoje.pedidos, ticketHoje: r0(P.hoje.ticket), ticketMes: r0(P.mes.ticket), devolucoesMes: r0(P.mes.devolucoes),
      leadsHoje: D.leads?.hoje ? { contatos: D.leads.hoje.contatos, convertidos: D.leads.hoje.leadsConvertidos, conversao: p1((D.leads.hoje.taxaConversao || 0) / 100) } : null,
      servicosMes: P.mes.resumo?.geral ? { garantia: r0(P.mes.resumo.geral.garantia), pacote: r0(P.mes.resumo.geral.pacote), sorteDobradaQtd: P.mes.resumo.geral.sorteQtd } : null,
    },
    zepSystem: z ? { hoje: zp(z.hoje), mes: zp(z.mes) } : null,
  };
}

const INSTRUCOES = `Você é o analista de vendas sênior da rede Baianão Móveis e Eletro (cerca de 40 lojas na Bahia, divididas nas regionais R1 a R4, cada uma com um líder).
As vendas acontecem em duas plataformas: Universo Baianão (principal, com metas) e ZepSystem (outra plataforma, mesmas lojas e vendedores, sem meta própria).
Você recebe os números do momento em JSON. Os valores JÁ VÊM FORMATADOS (ex.: "R$ 586,2 mil", "R$ 6,7 mi", "65,4%"): copie exatamente como estão, NUNCA converta, some ou recalcule valores. Escreva para o dono da rede e os gestores: português do Brasil, direto, profissional, sem enrolação.
"hoje" é o dia em andamento (parcial até o horário em "agora"); "mesAteHoje" é o acumulado do mês; "projecaoMes" é a estimativa de fechamento.
"categoriasMes" e "servicosMes" são da REDE inteira (não de uma loja); cada número pertence só ao item onde aparece no JSON: nunca atribua um número da rede a uma loja ou regional.
Regras: use SOMENTE os números do JSON, não invente nada; cite lojas, regionais e vendedores pelo nome quando ajudar; não repita o mesmo número em vários lugares; se algo for incerto, diga.
Responda APENAS um JSON válido neste formato:
{"manchete": "uma frase curta com a situação mais importante agora",
 "resumo": "3 a 5 frases: como está hoje, como está o mês, a projeção e o que mais pesa",
 "destaques": ["até 4 pontos positivos, cada um com número"],
 "atencao": ["até 4 riscos ou problemas, cada um com número"],
 "acoes": ["até 4 ações práticas para hoje/amanhã, cada uma dizendo QUEM (líder da regional, gerente da loja X) faz O QUÊ, baseada num número do JSON. Proibido conselho genérico como 'treinar vendedores' ou 'revisar estratégia'"]}`;

export async function analiseIA(D) {
  const { CF_ACCOUNT_ID, CF_AI_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) return null;
  let cache = null;
  try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (e) {}
  // a cada 30 min (o limite grátis é por dia); reaproveita a última análise no meio-tempo
  if (cache?.geradoEm && Date.now() - new Date(cache.geradoEm).getTime() < 29 * 60e3 && cache.dia === D.periodos.hoje.inicio) return cache;
  const ctx = JSON.stringify(contexto(D));
  for (const modelo of MODELOS) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${CF_AI_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelo, temperature: 0.2, max_tokens: 6000, reasoning_effort: "low",
          messages: [{ role: "system", content: INSTRUCOES }, { role: "user", content: ctx }] }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { console.log(`⚠️ IA ${modelo}: HTTP ${r.status}`); continue; }
      const j = await r.json();
      const msg = j.choices?.[0]?.message || {};
      const txt = String(msg.content || msg.reasoning_content || "");
      if (!txt.includes("{")) throw new Error(`sem JSON na resposta (${j.choices?.[0]?.finish_reason || "?"})`);
      const out = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
      if (!out.resumo) throw new Error("resposta sem resumo");
      const res = { geradoEm: new Date().toISOString(), dia: D.periodos.hoje.inicio, modelo: modelo.split("/").pop(), ...out };
      fs.writeFileSync(CACHE, JSON.stringify(res));
      console.log(`✅ Análise da IA atualizada (${res.modelo})`);
      return res;
    } catch (e) { console.log(`⚠️ IA ${modelo}: ${String(e.message).slice(0, 100)}`); }
  }
  return cache && cache.dia === D.periodos.hoje.inicio ? cache : null;
}
export { contexto as contextoIA };
