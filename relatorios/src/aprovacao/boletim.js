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
