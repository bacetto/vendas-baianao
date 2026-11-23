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

export function estadoInicial() {
  return { regras: {}, pausado: false, abaixo: "reprovar", teto: null, avisados: {}, historico: [], dia: null };
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

export function textoRegras(e) {
  const linhas = REGIONAIS.map((r) => `• *${r}*: ${e.regras[r]?.min != null ? `aprova com margem Reg. ≥ ${pct(e.regras[r].min)}` : "manual (fica pro Ed)"}`);
  return [
    `📋 *Regras do robô de descontos*${e.pausado ? " — ⏸️ *PAUSADO*" : ""}`,
    ...linhas,
    `• Abaixo do mínimo: ${e.abaixo === "manual" ? "fica pro Ed" : "reprova"}`,
    `• Teto de desconto: ${e.teto != null ? pct(e.teto) : "sem teto"}`,
  ].join("\n");
}

export const AJUDA = [
  "🤖 *Comandos do robô de descontos*",
  "*R1 42* → R1 aprova se a margem do regional ficar ≥ 42%",
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
  if ((m = low.match(/^r\s*([1-4])\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%?$/))) {
    const r = `R${m[1]}`, v = num(m[2]);
    if (v == null || v < 0 || v > 100) return { resposta: "⚠️ Valor inválido. Ex.: *R1 42*", mudou: false };
    e.regras[r] = { min: v, em: new Date().toISOString() };
    return { resposta: `✅ *${r}*: aprova se a margem do regional ficar em *${pct(v)}* ou mais.${e.pausado ? "\n⏸️ Robô está pausado — mande *ligar*." : ""}`, mudou: true };
  }
  if ((m = low.match(/^r\s*([1-4])\s*(manual|off|desligar|nao)$/))) {
    const r = `R${m[1]}`;
    delete e.regras[r];
    return { resposta: `✅ *${r}*: manual — os pedidos do ${r} ficam pro Ed decidir no portal.`, mudou: true };
  }
  if ((m = low.match(/^(todas|todos|tudo|geral)\s*[:=-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%?$/))) {
    const v = num(m[2]);
    for (const r of REGIONAIS) e.regras[r] = { min: v, em: new Date().toISOString() };
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
  if (/^(pausar|pausa|parar|para)$/.test(low)) { e.pausado = true; return { resposta: "⏸️ Robô *pausado*. Tudo fica pro Ed até mandar *ligar*.", mudou: true }; }
  if (/^(ligar|liga|retomar|voltar)$/.test(low)) { e.pausado = false; return { resposta: `▶️ Robô *ligado*.\n\n${textoRegras(e)}`, mudou: true }; }
  if (/^(regras|regra|status)$/.test(low)) return { resposta: textoRegras(e), mudou: false };
  if (/^(ajuda|comandos|help|\?)$/.test(low)) return { resposta: AJUDA, mudou: false };
  return null;
}

// Decide um pedido pendente. item = objeto do portal; regional = "R1".."R4".
export function decidir(item, regional, e) {
  const margem = item?.evaluation?.regionalMargin;
  const desc = item?.discountPercentage;
  const regra = e.regras[regional];
  if (e.pausado) return { acao: "MANUAL", motivo: "robô pausado" };
  if (!REGIONAIS.includes(regional)) return { acao: "MANUAL", motivo: `loja sem regional (${regional || "?"})` };
  if (!regra || regra.min == null) return { acao: "MANUAL", motivo: `${regional} sem regra` };
  if (typeof margem !== "number" || !Number.isFinite(margem)) return { acao: "MANUAL", motivo: "portal não trouxe a margem do regional" };
  if (e.teto != null && typeof desc === "number" && desc > e.teto) return { acao: "MANUAL", motivo: `desconto ${pct(desc)} acima do teto ${pct(e.teto)}` };
  if (margem >= regra.min) return { acao: "APROVAR", motivo: `margem Reg. ${pct(margem)} ≥ mínimo ${pct(regra.min)}` };
  if (e.abaixo === "manual") return { acao: "MANUAL", motivo: `margem Reg. ${pct(margem)} abaixo do mínimo ${pct(regra.min)}` };
  return { acao: "REPROVAR", motivo: `margem Reg. ${pct(margem)} abaixo do mínimo ${pct(regra.min)}` };
}

const brl = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

export function textoAviso(item, regional, d, e, resultado) {
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
    `📝 ${d.motivo}`,
    d.acao === "MANUAL"
      ? (regional && REGIONAIS.includes(regional) ? `👉 Pra eu decidir este e os próximos do ${regional}: mande *${regional} ${regra ?? 40}*` : null)
      : `👉 Próximo do ${regional} segue com mínimo *${pct(regra)}*. Pra mudar: *${regional} ${regra != null ? Math.round(regra) + 1 : 42}*`,
  ].filter(Boolean).join("\n");
}
