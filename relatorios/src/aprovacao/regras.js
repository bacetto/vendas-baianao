// Regras do Ed para os "Orçamentos para aprovação" — lógica pura (sem portal, sem WhatsApp), testável.
//
// Regra por regional: margem mínima do regional (a "Reg." que o portal mostra no pedido, já com o desconto).
//   margem Reg. >= mínimo  -> APROVA
//   margem Reg. <  mínimo  -> REPROVA (ou deixa pro Ed, se "abaixo manual")
//   regional sem regra / robô pausado / dado faltando -> fica pro Ed decidir no portal (e avisa)
//
// Comandos (mensagem no WhatsApp, sozinha na mensagem):
//   R1 42        mínimo do R1 = 42%        (aceita 42,5 / 42.5 / 42%)
//   R1 manual    R1 sem robô (tudo do R1 fica pro Ed)
//   todas 41     mesmo mínimo pra R1–R4
//   teto 40      não decide sozinho pedido com desconto acima de 40% (teto off = sem teto)
//   abaixo reprovar | abaixo manual
//   pausar | ligar | regras | ajuda

export const REGIONAIS = ["R1", "R2", "R3", "R4"];
export const SERV_PADRAO = 7;
export const servMin = (e) => (e.servMin === undefined ? SERV_PADRAO : e.servMin);

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
  if (g.min == null) return `*${r}*: manual (fica pro Ed)`;
  return `*${r}*: aprova se a margem do regional ficar ≥ *${pct(g.min)}*${g.max != null ? ` e o desconto do pedido for até *${pct(g.max)}*` : " (sem máximo de desconto)"}`;
}
export function textoRegras(e) {
  const linhas = REGIONAIS.map((r) => `• ${textoRegra(r, e)}`);
  return [
    `📋 *Regras do robô de descontos*${e.pausado ? " — ⏸️ *PAUSADO*" : ""}`,
    ...linhas,
    `• Fora da regra: ${e.abaixo === "manual" ? "fica pro Ed" : "reprova"}`,
    `• Serviços: ${servMin(e) != null ? `o regional precisa ter ≥ *${pct(servMin(e))}* das vendas do mês em serviços` : "sem exigência"}`,
    ...(e.teto != null ? [`• Teto geral: acima de ${pct(e.teto)} fica pro Ed`] : []),
  ].join("\n");
}

export const AJUDA = [
  "🤖 *Comandos do robô de descontos*",
  "*R1 42* → R1 aprova se a margem do regional ficar ≥ 42%",
  "*R1 max 30* → no R1, pedido com desconto acima de 30% não passa (*R1 max off* tira)",
  "*R1 42 max 30* → as duas regras de uma vez",
  "*servicos 7* → regional precisa ter ≥ 7% das vendas do mês em serviços (*servicos off* tira)",
  "*R1 manual* → R1 fica todo pro Ed",
  "*todas 41* → mesmo mínimo pra R1 a R4",
  "*teto 40* → acima de 40% de desconto nunca decide sozinho (*teto off* tira)",
  "*abaixo reprovar* / *abaixo manual* → o que fazer abaixo do mínimo",
  "*pausar* / *ligar* · *regras* · *ajuda*",
].join("\n");

// Interpreta uma mensagem. Retorna null se não for comando; senão { resposta, mudou }.
export function comando(texto, e) {
  const t = String(texto || "").trim().replace(/\s+/g, " ");
  if (!t || t.length > 40) return null;
  const low = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let m;
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
    return { resposta: `✅ *${r}*: manual — os pedidos do ${r} ficam pro Ed decidir no portal.`, mudou: true };
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
  if ((m = low.match(/^abaixo\s+(reprovar|reprova|manual)$/))) {
    e.abaixo = m[1] === "manual" ? "manual" : "reprovar";
    return { resposta: `✅ Abaixo do mínimo: ${e.abaixo === "manual" ? "fica pro Ed decidir" : "o robô reprova"}.`, mudou: true };
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

// Decide um pedido pendente. item = objeto do portal; regional = "R1".."R4".
export function decidir(item, regional, e, serv) {
  const margem = item?.evaluation?.regionalMargin;
  const desc = item?.discountPercentage;
  const regra = e.regras[regional];
  if (e.pausado) return { acao: "MANUAL", motivo: "robô pausado" };
  if (!REGIONAIS.includes(regional)) return { acao: "MANUAL", motivo: `loja sem regional (${regional || "?"})` };
  if (!regra || regra.min == null) return { acao: "MANUAL", motivo: `${regional} sem regra` };
  if (typeof margem !== "number" || !Number.isFinite(margem)) return { acao: "MANUAL", motivo: "portal não trouxe a margem do regional" };
  if (e.teto != null && typeof desc === "number" && desc > e.teto) return { acao: "MANUAL", motivo: `desconto ${pct(desc)} acima do teto ${pct(e.teto)}` };
  const fora = (motivo) => (e.abaixo === "manual" ? { acao: "MANUAL", motivo } : { acao: "REPROVAR", motivo });
  if (regra.max != null) {
    if (typeof desc !== "number" || !Number.isFinite(desc)) return { acao: "MANUAL", motivo: "portal não trouxe o % de desconto" };
    if (desc > regra.max + 1e-6) return fora(`desconto do pedido ${pct(desc)} acima do máximo ${pct(regra.max)} do ${regional}`);
  }
  if (margem < regra.min) return fora(`margem Reg. ${pct(margem)} abaixo do mínimo ${pct(regra.min)}`);
  const sm = servMin(e);
  if (sm != null) {
    if (!serv || typeof serv.pct !== "number" || !Number.isFinite(serv.pct)) return { acao: "ESPERAR", motivo: "sem os dados de serviços do regional" };
    if (serv.pct < sm) return fora(`serviços do ${regional} em ${pct(serv.pct)} das vendas do mês, abaixo do mínimo ${pct(sm)}`);
  }
  return { acao: "APROVAR", motivo: `margem Reg. ${pct(margem)} ≥ mínimo ${pct(regra.min)}${regra.max != null ? `, desconto ${pct(desc)} ≤ máximo ${pct(regra.max)}` : ""}${sm != null ? `, serviços ${pct(serv.pct)} ≥ ${pct(sm)}` : ""}` };
}

const brl = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

export function textoAviso(item, regional, d, e, resultado, serv) {
  const ev = item.evaluation || {};
  const prod = (item.products || []).map((p) => p.description || p.name || p.productName).filter(Boolean)[0];
  const cab = {
    APROVAR: resultado === "ok" ? "✅ *APROVADO pelo robô*" : "❌ *Falhou ao aprovar* — aprove no portal",
    REPROVAR: resultado === "ok" ? "🚫 *REPROVADO pelo robô*" : "❌ *Falhou ao reprovar* — decida no portal",
    MANUAL: "⏳ *AGUARDANDO O ED* (no portal)",
  }[d.acao];
  const regra = e.regras[regional]?.min;
  return [
    `${cab} · #${item.orderNumber}`,
    `🏬 ${item.branchName || item.branchCode} · *${regional || "?"}*`,
    prod ? `📦 ${String(prod).slice(0, 60)}` : null,
    `💸 Desconto: *${pct(item.discountPercentage)}* (${brl(item.discountValue)})`,
    `📊 Margem com o pedido → Reg.: *${pct(ev.regionalMargin)}* · LJ: ${pct(ev.storeMargin)} · Dir.: ${pct(ev.directorMargin)}`,
    serv && typeof serv.pct === "number" ? `🛠️ Serviços do ${regional} no mês: *${pct(serv.pct)}* das vendas` : null,
    `📝 ${d.motivo}`,
    d.acao === "MANUAL"
      ? (regional && REGIONAIS.includes(regional) ? `👉 Pra eu decidir este e os próximos do ${regional}: mande *${regional} ${regra ?? 40}*` : null)
      : `👉 Próximo do ${regional}: ${textoRegra(regional, e).replace(/^\*R\d\*: /, "")}. Pra mudar: *${regional} ${regra != null ? Math.round(regra) + 1 : 42}* ou *${regional} max 25*`,
  ].filter(Boolean).join("\n");
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
