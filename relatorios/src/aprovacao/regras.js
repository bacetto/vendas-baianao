// Regras do Ed para os "Orçamentos para aprovação" — lógica pura (sem portal, sem WhatsApp), testável.
//
// Regra por regional: margem mínima do regional (a "Reg." que o portal mostra no pedido, já com o desconto).
//   margem Reg. >= mínimo  -> APROVA
//   fora da regra -> NÃO FAZ NADA no portal (nunca reprova); só avisa no grupo de detalhamento
//   regional sem regra / robô pausado / dado faltando -> fica pro Ed decidir no portal (e avisa)
//
// Comandos (mensagem no WhatsApp, sozinha na mensagem):
//   R1 42        mínimo do R1 = 42%        (aceita 42,5 / 42.5 / 42%)
//   R1 manual    R1 sem robô (tudo do R1 fica pro Ed)
//   todas 41     mesmo mínimo pra R1–R4
//   teto 40      não decide sozinho pedido com desconto acima de 40% (teto off = sem teto)
//   pausar | ligar | regras | ajuda

export const REGIONAIS = ["R1", "R2", "R3", "R4"];


export function estadoInicial() {
  return { regras: {}, pausado: false, abaixo: "reprovar", teto: null, avisados: {}, solicitados: {}, historico: [], dia: null };
}

export function regionalDe(valor) {
  const s = String(valor || "").toUpperCase();
  const m = s.match(/\bR\s*-?\s*(\d)\b/) || s.match(/REGIONAL\s*-?\s*(\d)/);
  return m ? `R${m[1]}` : s.trim() || null;
}

const num = (s) => {
  const n = Number(String(s).replace("%", "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};
export const pct = (n) => (n == null ? "—" : `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`);

export function textoRegra(r, e) {
  const g = e.regras[r] || {};
  if (g.min == null && g.max == null && g.serv == null) return `*${r}* · manual (fica pro Ed)`;
  const t = `*${r}* · ${g.min != null ? `M${num2(g.min)}` : "M ?"} · ${g.max != null ? `D${num2(g.max)}` : "D ?"} · ${g.serv != null ? `S${num2(g.serv)}` : "S ?"}`;
  return g.min != null && g.max != null && g.serv != null ? t : `${t} — ⚠️ incompleta: fica pro Ed`;
}
const num2 = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
export function textoRegras(e) {
  const linhas = REGIONAIS.map((r) => `• ${textoRegra(r, e)}`);
  return [
    `📋 *Regras*${e.pausado ? " — ⏸️ *PAUSADO*" : ""}`,
    ...linhas,
    "_M = margem mínima do regional · D = desconto máximo do pedido · S = serviços mínimos do regional (% das vendas do mês)_",
  ].join("\n");
}

export const AJUDA = [
  "🤖 *Como mandar as regras*",
  "*R1 - M40 - D30 - S7*",
  "M40 = margem do regional fica no mínimo 40%",
  "D30 = desconto do pedido no máximo 30%",
  "S7 = serviços no mínimo 7% das vendas do regional no mês",
  "Pode mudar só um: *R1 - D25*",
  "*R1 manual* = R1 fica pro Ed decidir",
  "*regras* · *pausar* · *ligar*",
].join("\n");

// Interpreta uma mensagem. Retorna null se não for comando; senão { resposta, mudou }.
export function comando(texto, e) {
  const t = String(texto || "").trim().replace(/\s+/g, " ");
  if (!t || t.length > 40) return null;
  const low = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let m;
  // R1 - M40 - D30 - S7  (qualquer ordem; pode mandar só uma parte; separador livre)
  if ((m = low.match(/^r\s*([1-4])\b(.*)$/)) && /\b[mds]\s*\d/.test(m[2]) && /^[\s\-–—:;,|/mds\d.,%]*$/.test(m[2])) {
    const r = `R${m[1]}`, g = { ...(e.regras[r] || {}) };
    const partes = [...m[2].matchAll(/([mds])\s*(\d+(?:[.,]\d+)?)\s*%?/g)];
    for (const [, k, v] of partes) { const n = num(v); if (n == null || n > 100) return { resposta: "⚠️ Não entendi. Ex.: *R1 - M40 - D30 - S7*", mudou: false }; g[{ m: "min", d: "max", s: "serv" }[k]] = n; }
    g.em = new Date().toISOString();
    e.regras[r] = g;
    return { resposta: `✅ ${textoRegra(r, e)}${e.pausado ? "\n⏸️ Robô pausado — mande *ligar*." : ""}`, mudou: true };
  }
  if ((m = low.match(/^r\s*([1-4])\s*(?:(\d{1,2}(?:[.,]\d{1,2})?)\s*%?\s*)?(?:max|maximo|desc|desconto)\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?|off|sem)\s*%?$/))) {
    const r = `R${m[1]}`;
    e.regras[r] ||= {};
    if (m[2]) e.regras[r].min = num(m[2]);
    e.regras[r].max = /off|sem/.test(m[3]) ? null : num(m[3]);
    e.regras[r].em = new Date().toISOString();
    return { resposta: `✅ ${textoRegra(r, e)}${e.regras[r].min == null ? `\n⚠️ Falta a margem mínima do ${r} (ex.: *${r} 42*) — sem ela o ${r} fica pro Ed.` : ""}`, mudou: true };
  }
  if ((m = low.match(/^r\s*([1-4])\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%?$/))) {
    const r = `R${m[1]}`, v = num(m[2]);
    if (v == null || v < 0 || v > 100) return { resposta: "⚠️ Valor inválido. Ex.: *R1 42*", mudou: false };
    e.regras[r] = { ...e.regras[r], min: v, em: new Date().toISOString() };
    return { resposta: `✅ ${textoRegra(r, e)}${e.pausado ? "\n⏸️ Robô está pausado — mande *ligar*." : ""}`, mudou: true };
  }
  if ((m = low.match(/^r\s*([1-4])\s*(manual|off|desligar|nao)$/))) {
    const r = `R${m[1]}`;
    delete e.regras[r];
    return { resposta: `✅ *${r}* · manual (fica pro Ed)`, mudou: true };
  }
  if ((m = low.match(/^(todas|todos|tudo|geral)\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%?$/))) {
    const v = num(m[2]);
    for (const r of REGIONAIS) e.regras[r] = { ...e.regras[r], min: v, em: new Date().toISOString() };
    return { resposta: `✅ R1 a R4: aprova com margem do regional ≥ *${pct(v)}*.`, mudou: true };
  }
  if ((m = low.match(/^teto\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?|off|sem)\s*%?$/))) {
    e.teto = /off|sem/.test(m[1]) ? null : num(m[1]);
    return { resposta: e.teto == null ? "✅ Sem teto de desconto." : `✅ Desconto acima de *${pct(e.teto)}* sempre fica pro Ed.`, mudou: true };
  }
  if ((m = low.match(/^serv(?:icos?|ico)?\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?|off|sem)\s*%?$/))) {
    e.servMin = /off|sem/.test(m[1]) ? null : num(m[1]);
    return { resposta: e.servMin == null ? "✅ Sem exigência de serviços." : `✅ Serviços: o regional precisa ter ≥ *${pct(e.servMin)}* das vendas do mês em serviços.`, mudou: true };
  }
  if (/^(pausar|pausa|parar|para)$/.test(low)) { e.pausado = true; return { resposta: "⏸️ Robô *pausado*. Tudo fica pro Ed até mandar *ligar*.", mudou: true }; }
  if (/^(ligar|liga|retomar|voltar)$/.test(low)) { e.pausado = false; return { resposta: `▶️ Robô *ligado*.\n\n${textoRegras(e)}`, mudou: true }; }
  if (/^(regras|regra|status)$/.test(low)) return { resposta: textoRegras(e), mudou: false };
  if (/^(ajuda|comandos|help|\?)$/.test(low)) return { resposta: AJUDA, mudou: false };
  return null;
}

// Como fica o regional SE o pedido for aprovado (base = resumo do mês do regional: venda, lucro, pacote de serviços).
// Margem do portal = lucro / custo. O "Reg." do pedido é a margem atual; somamos o efeito do pedido em cima dele.
export function projetar(item, base) {
  if (!base || !(base.venda > 0)) return null;
  const prods = item.products || [];
  const pl = prods.reduce((a, p) => a + (Number(p.profit) || 0), 0);
  const pc = prods.reduce((a, p) => a + (Number(p.unitCost) || 0) * (Number(p.quantity) || 0), 0);
  const fv = Number(item.finalValue) || prods.reduce((a, p) => a + (Number(p.finalValue) || 0), 0);
  const sv = (item.services || []).reduce((a, s) => a + (Number(s.finalValue) || 0), 0);
  const servAtual = (100 * base.pacote) / base.venda;
  const servCom = (100 * (base.pacote + sv)) / (base.venda + fv);
  let margemAtual = item.evaluation?.regionalMargin, margemCom = null;
  if (typeof base.lucro === "number" && base.venda - base.lucro > 0 && pc > 0 && typeof margemAtual === "number") {
    const C = base.venda - base.lucro;
    margemCom = margemAtual + 100 * ((base.lucro + pl) / (C + pc) - base.lucro / C);
  }
  return { margemAtual, margemCom, servAtual, servCom };
}

// Decide um pedido pendente. item = objeto do portal; regional = "R1".."R4".
export function decidir(item, regional, e, base) {
  // REGRA DE OURO: só APROVA se M, D e S estiverem cadastrados E os 3 forem cumpridos com números confiáveis.
  // Qualquer dado faltando, estranho ou dúvida -> MANUAL (não faz nada no portal; o Ed decide).
  const ok = (n) => typeof n === "number" && Number.isFinite(n);
  const regra = e.regras[regional] || {};
  const desc = item?.discountPercentage;
  if (e.pausado) return { acao: "MANUAL", motivo: "robô pausado" };
  if (!REGIONAIS.includes(regional)) return { acao: "MANUAL", motivo: `loja sem regional (${regional || "?"})` };
  if (!ok(regra.min) || !ok(regra.max) || !ok(regra.serv)) return { acao: "MANUAL", motivo: `${regional} sem as 3 regras (M, D e S) cadastradas` };
  if (!ok(desc) || desc < 0 || desc > 100) return { acao: "MANUAL", motivo: "portal não trouxe o % de desconto" };
  // pedido sem custo/lucro dos produtos não dá pra projetar margem
  const num0 = (v) => v !== null && v !== undefined && v !== "" && ok(Number(v));
  const prods = item.products || [];
  if (!prods.length || prods.some((p) => !num0(p.profit) || !num0(p.unitCost) || !num0(p.quantity) || Number(p.unitCost) <= 0 || Number(p.quantity) <= 0)) return { acao: "MANUAL", motivo: "pedido sem custo/lucro dos produtos" };
  if (!num0(item.finalValue) || Number(item.finalValue) <= 0) return { acao: "MANUAL", motivo: "pedido sem valor final" };
  const proj = projetar(item, base);
  if (!proj) return { acao: "ESPERAR", motivo: "sem os números do mês do regional" };
  const margem = proj.margemCom, serv = proj.servCom;
  if (!ok(margem) || margem <= 0 || margem > 100) return { acao: "MANUAL", motivo: "não deu pra calcular com segurança a margem do regional com o pedido" };
  if (!ok(serv) || serv < 0 || serv > 100) return { acao: "MANUAL", motivo: "não deu pra calcular com segurança os serviços do regional com o pedido" };
  // fora da regra: NUNCA reprova — não faz nada no portal e avisa (o Ed decide)
  const fora = (motivo) => ({ acao: "MANUAL", motivo: `fora da regra: ${motivo}` });
  const falhas = [];
  if (desc > regra.max + 1e-9) falhas.push(`desconto ${pct(desc)} acima do D${num2(regra.max)}`);
  if (margem < regra.min) falhas.push(`margem com o pedido ${pct(margem)} abaixo do M${num2(regra.min)}`);
  if (serv < regra.serv) falhas.push(`serviços com o pedido ${pct(serv)} abaixo do S${num2(regra.serv)}`);
  if (falhas.length) return fora(falhas.join(" · "));
  return { acao: "APROVAR", motivo: `com o pedido: margem ${pct(margem)} ≥ M${num2(regra.min)} · desconto ${pct(desc)} ≤ D${num2(regra.max)} · serviços ${pct(serv)} ≥ S${num2(regra.serv)}` };
}

const brl = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

// serviços que vieram no próprio pedido (Sorte Dobrada, Garantia...)
export function textoServicosVenda(item) {
  const sv = (item.services || []).filter((x) => (Number(x.finalValue) || 0) > 0 || (Number(x.quantity) || 0) > 0);
  if (!sv.length) return "🛠️ *Sem serviço na venda*";
  const nome = (x) => String(x.description || x.code || "serviço").trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const total = sv.reduce((a, x) => a + (Number(x.finalValue) || 0), 0);
  return `🛠️ *Com serviço:* ${sv.map((x) => `${nome(x)}${Number(x.quantity) > 1 ? ` (${x.quantity}x)` : ""}`).join(", ")} · ${brl(total)}`;
}

export function textoAviso(item, regional, d, e, resultado, base) {
  const proj = projetar(item, base);
  const ev = item.evaluation || {};
  const g = e.regras[regional] || {};
  const prod = (item.products || []).map((p) => p.description || p.name || p.productName).filter(Boolean)[0];
  const foraRegra = d.acao === "MANUAL" && /^fora da regra/.test(d.motivo);
  const cab = d.acao === "APROVAR"
    ? (resultado === "ok" ? "✅ *APROVADO*" : "❌ *NÃO CONSEGUI APROVAR* — aprove no portal")
    : foraRegra ? "⛔ *NÃO LIBERADO* — fica pro Ed" : "⏳ *FICA PRO ED*";
  const L = "━━━━━━━━━━━━━━";
  const out = [
    cab,
    "",
    `*#${item.orderNumber}* · *${regional || "?"}*`,
    `🏬 ${String(item.branchName || item.branchCode).replace(/^BAIANAO\s*\/\s*/i, "")}`,
    prod ? `📦 ${String(prod).slice(0, 45)}` : null,
    `💸 ${brl(item.discountValue)} de desconto`,
    textoServicosVenda(item),
  ];
  const temRegras = [g.min, g.max, g.serv].every((n) => typeof n === "number");
  const mc = proj?.margemCom, sc = proj?.servCom, dc = item.discountPercentage;
  if (temRegras && typeof mc === "number" && typeof sc === "number") {
    const linha = (ok, nome, valor, lim) => `${ok ? "✅" : "❌"} ${nome}: *${pct(valor)}*  _(${lim})_`;
    out.push("", L, `*REGRAS DO ${regional}*`,
      linha(dc <= g.max + 1e-9, "Desconto", dc, `máx. ${num2(g.max)}%`),
      linha(mc >= g.min, "Margem", mc, `mín. ${num2(g.min)}%`),
      linha(sc >= g.serv, "Serviços", sc, `mín. ${num2(g.serv)}%`),
      L,
      `_Margem e serviços do ${regional} já contando este pedido (hoje: ${pct(proj.margemAtual)} e ${pct(proj.servAtual)})_`);
  } else {
    out.push("", `📝 ${d.motivo}`);
    if (regional && REGIONAIS.includes(regional) && !temRegras) out.push("", `👉 Pra o robô decidir o ${regional}, mande: *${regional} - M40 - D20 - S7*`);
  }
  if (d.acao === "APROVAR" && resultado !== "ok") out.push("", `📝 ${d.motivo}`);
  return out.filter((x) => x !== null).join("\n");
}

// Lê os pedidos de uma mensagem do grupo LIBERAÇÃO DESCONTO ("Filial: 33 / Pedido: 036403 / ...").
// Uma mensagem pode ter mais de um pedido. Retorna [{ pedido: "36403", filial: "33" | null }] (sem zeros à esquerda).
export const semZero = (s) => String(s ?? "").trim().replace(/^0+(?=\d)/, "");
export function lerPedidos(texto) {
  const t = String(texto || "").replace(/\*/g, "");
  const filiais = [...t.matchAll(/filial\s*[:\-]?\s*(\d{1,7})/gi)].map((m) => semZero(m[1]));
  const peds = [...t.matchAll(/pedido\s*[:\-#nº°.]*\s*(\d{4,7})/gi)].map((m) => semZero(m[1]));
  return peds.map((pedido, i) => ({ pedido, filial: filiais[i] ?? filiais[0] ?? null }));
}
// o pedido do grupo bate com o item do portal? (número do pedido; e a filial, se informada)
export function bate(sol, item) {
  if (semZero(item.orderNumber) !== sol.pedido) return false;
  if (!sol.filial) return true;
  const b = semZero(String(item.branchCode || "").trim().slice(-3));
  return b === sol.filial || semZero(String(item.branchCode || "").trim()).endsWith(sol.filial);
}
