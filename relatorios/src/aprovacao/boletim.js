// Boletim pro Ed de 2 em 2 horas: parcial do DIA — margem e serviços de cada regional.
//   R1 - 40% / 6%
// Lógica pura (testável). r = resultado de portal.resumoDia(): { R1: { margem, pct, ... }, ... }
export const BOLETIM_HORAS = [10, 12, 14, 16, 18, 20, 22]  // às 8h as lojas ainda não abriram;
const REGS = ["R1", "R2", "R3", "R4"];
const p = (n) => `${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
const ok = (n) => typeof n === "number" && Number.isFinite(n);

export function textoBoletim(r, h) {
  const linhas = REGS.filter((k) => ok(r?.[k]?.margem) && ok(r?.[k]?.pct)).map((k) => `${k} - ${p(r[k].margem)} / ${p(r[k].pct)}`);
  if (linhas.length < REGS.length) return null; // faltou regional: não manda número pela metade
  return [`📊 *Parcial do dia — ${String(h).padStart(2, "0")}h*`, "_Margem / Serviços_", "", ...linhas].join("\n");
}

// Lojas que venderam menos de R$ 5 mil nas últimas 2 horas (diferença entre 2 leituras da venda do dia).
// Fotos tiradas às 9, 11, 13 ... 21h; envio às 11, 13 ... 21h.
export const JANELA_HORAS = [11, 13, 15, 17, 19, 21];
export const FOTO_HORAS = [9, ...JANELA_HORAS];
export const LIMITE_JANELA = 5000;
const brl = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
// antes/agora: { num: venda }; info: { num: { reg, nome } }
export function textoJanela(antes, agora, info, h) {
  const hh = (x) => `${String(x).padStart(2, "0")}h`;
  const ls = Object.entries(agora).filter(([n]) => n in antes && /^R[1-4]$/.test(info[n]?.reg || ""))
    .map(([n, v]) => ({ n, reg: info[n].reg, nome: info[n].nome, v: Math.max(0, v - antes[n]) }))
    .filter((l) => l.v < LIMITE_JANELA)
    .sort((a, b) => a.reg.localeCompare(b.reg) || a.v - b.v);
  const cab = `📉 *Lojas abaixo de R$ 5 mil* — ${hh(h - 2)} às ${hh(h)}`;
  if (!ls.length) return `${cab}\n\n✅ Nenhuma loja abaixo de R$ 5 mil.`;
  const out = [cab];
  let r = null;
  for (const l of ls) { if (l.reg !== r) { r = l.reg; out.push("", `*${r}*`); } out.push(`• ${l.nome} — ${brl(l.v)}`); }
  return out.join("\n");
}
