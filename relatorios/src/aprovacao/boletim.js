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
// nomes encurtados pra caber numa linha do WhatsApp (pedido do Gabriel)
const APELIDO = { "VALE DAS PEDRINHAS": "VALE PEDRINHAS" };
const curto = (n) => APELIDO[String(n || "").trim().toUpperCase()] || n;
const qtd = (n) => `${n} pedido${n === 1 ? "" : "s"}`;
// foto de cada loja: número (venda líquida do dia, formato antigo) ou { v: líquida, b: vendido bruto, d: devoluções, p: pedidos }
const val = (x) => (typeof x === "number" ? { v: x } : x || { v: 0 });
// antes/agora: { num: foto }; info: { num: { reg, nome } }
// Regra (não mudou): entra a loja cuja venda líquida nas 2h ficou abaixo de R$ 5 mil.
// Mostra se a loja vendeu (quanto e em quantos pedidos) ou se o número caiu por devolução.
export function textoJanela(antes, agora, info, h) {
  const hh = (x) => `${String(x).padStart(2, "0")}h`;
  const ls = Object.entries(agora).filter(([n]) => n in antes && /^R[1-4]$/.test(info[n]?.reg || ""))
    .map(([n, x]) => {
      const a = val(antes[n]), g = val(x), det = a.b != null && g.b != null;
      return { n, reg: info[n].reg, nome: info[n].nome, liq: g.v - a.v, det,
        vend: det ? Math.max(0, g.b - a.b) : null, devol: det ? Math.max(0, g.d - a.d) : null, ped: det ? Math.max(0, g.p - a.p) : null };
    })
    .filter((l) => (l.det ? l.vend : l.liq) < LIMITE_JANELA) // vendeu menos de R$ 5 mil nas 2h
    .sort((a, b) => a.reg.localeCompare(b.reg) || (a.det ? a.vend : a.liq) - (b.det ? b.vend : b.liq));
  const cab = `📉 *Lojas abaixo de R$ 5 mil* — ${hh(h - 2)} às ${hh(h)}`;
  if (!ls.length) return `${cab}\n\n✅ Nenhuma loja abaixo de R$ 5 mil.`;
  const nome = (l) => `${String(l.n).padStart(2, "0")} · ${curto(l.nome)}`;
  // formato de antes: nome da loja e quanto ela VENDEU nas 2 horas (sem descontar devolução)
  const linha = (l) => `• ${curto(l.nome)} — ${brl(l.det ? l.vend : Math.max(0, l.liq))}`;
  const out = [cab];
  let r = null;
  for (const l of ls) { if (l.reg !== r) { r = l.reg; out.push("", `*${r}*`); } out.push(linha(l)); }
  return out.join("\n");
}

// Lojas com menos de 3 CONTATOS com leads NO DIA (contato com o lead, não venda), contando desde a abertura até a hora do envio.
// Pro Ed, de 3 em 3h. (Antes contava só as últimas 3h; o Gabriel pediu o acumulado do dia em 25/11.)
export const LEADS_HORAS = [11, 14, 17, 20];
export const LIMITE_LEADS = 3;
// agora: { num: contatos acumulados no dia }; abertas: { num: { reg, nome } }
export function textoLeads(agora, abertas, h) {
  const hh = (x) => `${String(x).padStart(2, "0")}h`;
  const ls = Object.entries(abertas).map(([n, i]) => ({ n, ...i, c: Math.max(0, agora[n] || 0) }))
    .filter((l) => l.c < LIMITE_LEADS).sort((a, b) => a.reg.localeCompare(b.reg) || a.c - b.c || Number(a.n) - Number(b.n));
  const cab = `📞 *Lojas com menos de ${LIMITE_LEADS} contatos com leads no dia* — até ${hh(h)}`;
  if (!ls.length) return `${cab}\n\n✅ Todas as lojas já fizeram ${LIMITE_LEADS} ou mais contatos hoje.`;
  const out = [cab];
  let r = null;
  for (const l of ls) { if (l.reg !== r) { r = l.reg; out.push("", `*${r}*`); } out.push(`• ${String(l.n).padStart(2, "0")} · ${curto(l.nome)} — ${l.c ? `${l.c} contato${l.c > 1 ? "s" : ""} no dia` : "❌ *nenhum contato hoje*"}`); }
  return out.join("\n");
}

// Lojas que NÃO venderam R$ 5 mil NO DIA (venda do dia até a hora do envio, sem descontar devolução). Enviado de 2 em 2h.
// agora: { num: foto } (foto com detalhe: b = vendido no dia); info: { num: { reg, nome } }
export function textoDia(agora, info, h) {
  const ls = Object.entries(agora).filter(([n]) => /^R[1-4]$/.test(info[n]?.reg || ""))
    .map(([n, x]) => { const g = val(x); return { n, reg: info[n].reg, nome: info[n].nome, v: g.b != null ? g.b : Math.max(0, g.v) }; })
    .filter((l) => l.v < LIMITE_JANELA)
    .sort((a, b) => a.reg.localeCompare(b.reg) || a.v - b.v);
  const cab = `📉 *Lojas abaixo de R$ 5 mil no dia* — até ${typeof h === "number" ? String(h).padStart(2, "0") + "h" : h}`;
  if (!ls.length) return `${cab}\n\n✅ Todas as lojas já venderam R$ 5 mil hoje.`;
  const out = [cab];
  let r = null;
  for (const l of ls) { if (l.reg !== r) { r = l.reg; out.push("", `*${r}*`); } out.push(`• ${curto(l.nome)} — ${brl(l.v)}`); }
  return out.join("\n");
}
