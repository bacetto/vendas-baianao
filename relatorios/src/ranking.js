// Monta o ranking (dados pro card + texto reserva) a partir das tabelas gravadas em ./saida
import fs from "node:fs";

export const NOME_LOJA = { 40: "SALVADOR NORTE" };
const NOMES = { R1: "UARA", R2: "DIEGO", R3: "ALEXANDRE", R4: "MICHEL" };
const pct = (s) => parseFloat(String(s).replace(/[^\d,-]/g, "").replace(",", "."));
const val = (s) => pct(s) || 0;
const n = (s) => Number(String(s).replace(/\D/g, "")) || 0;
const nome = (r) => `${r}${NOMES[r] ? ` - ${NOMES[r]}` : ""}`;
// piores = do fim pro começo, sem repetir quem já está nas melhores
const piores = (asc, top, q = 3) => asc.filter((l) => !top.includes(l)).slice(0, q);

// Resultado por Regional -> { melhor, pior, top, fundo, vazio }
export function dadosRanking(arq = "saida/regional.txt", q = 3) {
  if (!fs.existsSync(arq)) return null;
  const linhas = fs.readFileSync(arq, "utf8").split("\n").map((l) => l.split(" | ").map((c) => c.trim()));
  const regs = new Map(), lojas = new Map();
  let total = null;
  for (const c of linhas) {
    if (c[0] === "Total Geral" && c.length >= 12 && !total) total = { venda: c[2], ptxt: c[3], sv: c[10], sptxt: c[11] };
    if (/^R[1-9]$/.test(c[0]) && c.length >= 4 && !regs.has(c[0])) regs.set(c[0], { reg: c[0], venda: c[2], p: pct(c[3]), ptxt: c[3], sv: c[10], sp: pct(c[11]), sptxt: c[11] });
    if (/^LOJA \d+$/i.test(c[0]) && /^R[1-9]$/.test(c[1]) && c.length >= 5 && !lojas.has(c[0])) lojas.set(c[0], { loja: c[0], reg: c[1], meta: c[2], venda: c[3], p: pct(c[4]), ptxt: c[4], sv: c[11], sp: pct(c[12]), sptxt: c[12] });
  }
  // nomes das lojas (Painel Leads aberto): "12 | CANDEIAS | ..."
  const nomes = {};
  const arqNomes = arq.replace(/regional\.txt$/, "lojas.txt");
  if (arqNomes !== arq && fs.existsSync(arqNomes))
    for (const l of fs.readFileSync(arqNomes, "utf8").split("\n")) {
      const [num, nm] = l.split(" | ").map((c) => c.trim());
      if (/^\d+$/.test(num) && nm) nomes[Number(num)] = NOME_LOJA[Number(num)] || nm;
    }
  const rs = [...regs.values()].filter((r) => !isNaN(r.p)).sort((a, b) => b.p - a.p);
  if (rs.length < 2) return null;
  // só lojas com meta no período (domingo/feriado só abrem as que têm meta)
  const comMeta = [...lojas.values()].filter((l) => val(l.meta) > 0);
  const todas = (comMeta.length ? comMeta : [...lojas.values()]).filter((l) => !isNaN(l.p));
  const top = [...todas].sort((a, b) => b.p - a.p).slice(0, q);
  const fundo = piores([...todas].sort((a, b) => a.p - b.p), top, q);
  const nomeLoja = (l) => { const nm = nomes[Number(l.loja.replace(/\D/g, ""))]; return nm ? `${l.loja} ${nm}` : l.loja; };
  const r = (x) => ({ nome: nome(x.reg), valor: x.venda, info: `${x.ptxt} da meta`, p: x.p });
  const l = (x) => ({ nome: nomeLoja(x), reg: nome(x.reg), valor: x.venda, info: `${x.ptxt} da meta`, p: x.p });
  // serviços (Pacote de Serviços = Sorte Dobrada + Garantia), ordenado pelo % sobre as vendas
  const comServ = (xs) => xs.filter((x) => !isNaN(x.sp));
  const rsS = comServ(rs).sort((a, b) => b.sp - a.sp);
  const topS = comServ(todas).sort((a, b) => b.sp - a.sp).slice(0, q);
  const fundoS = piores(comServ(todas).sort((a, b) => a.sp - b.sp), topS, q);
  const rS = (x) => ({ nome: nome(x.reg), valor: x.sv, info: `${x.sptxt} das vendas`, p: x.sp });
  const lS = (x) => ({ nome: nomeLoja(x), reg: nome(x.reg), valor: x.sv, info: `${x.sptxt} das vendas`, p: x.sp });
  return {
    tipo: "VENDAS",
    vazio: rs.every((x) => val(x.venda) === 0),
    melhor: r(rs[0]), pior: r(rs[rs.length - 1]),
    regs: rs.map(r),
    top: top.map(l), fundo: fundo.map(l),
    total: total && { valor: total.venda, info: `${total.ptxt} da meta` },
    servicos: rsS.length >= 2 ? {
      total: total && { valor: total.sv, info: `${total.sptxt} das vendas` },
      melhor: rS(rsS[0]), pior: rS(rsS[rsS.length - 1]), regs: rsS.map(rS), top: topS.map(lS), fundo: fundoS.map(lS),
    } : null,
  };
}

// números das lojas com meta > 0 na tabela "Resultado por Regional"
function lojasComMeta(arq) {
  const s = new Set();
  if (!fs.existsSync(arq)) return s;
  for (const l of fs.readFileSync(arq, "utf8").split("\n")) {
    const c = l.split(" | ").map((x) => x.trim());
    if (/^LOJA \d+$/i.test(c[0]) && /^R[1-9]$/.test(c[1]) && val(c[2]) > 0) s.add(Number(c[0].replace(/\D/g, "")));
  }
  return s;
}

// Painel Leads (saida/lojas.txt, com as regionais abertas) -> mesmo formato
export function dadosRankingLeads(arq = "saida/lojas.txt", q = 3) {
  if (!fs.existsSync(arq)) return null;
  const regs = [], lojas = [];
  let atual = null, totalL = null;
  for (const linha of fs.readFileSync(arq, "utf8").split("\n")) {
    const c = linha.split(" | ").map((x) => x.trim());
    const sub = c[0].match(/^Subtotal (R[1-9])\b/);
    if (sub) { atual = sub[1]; regs.push({ reg: atual, contatos: c[1], conv: c[2], p: pct(c[3]), ptxt: c[3], valor: c[4] }); continue; }
    if (/^Total Geral/i.test(c[0]) && !totalL) totalL = { contatos: c[1], conv: c[2], ptxt: c[3], valor: c[4] };
    if (/^Subtotal|^Total Geral/i.test(c[0])) { atual = null; continue; }
    if (atual && /^\d+$/.test(c[0]) && c.length >= 6)
      lojas.push({ loja: `LOJA ${c[0].padStart(2, "0")} ${NOME_LOJA[Number(c[0])] || c[1]}`, reg: atual, contatos: c[2], conv: c[3], p: pct(c[4]), ptxt: c[4], valor: c[5] });
  }
  // só lojas com meta no período (lidas do regional.txt ao lado); se não houver, usa todas
  const abertas = lojasComMeta(arq.replace(/lojas\.txt$/, "regional.txt"));
  if (abertas.size) for (let i = lojas.length - 1; i >= 0; i--) if (!abertas.has(Number(lojas[i].loja.match(/\d+/)[0]))) lojas.splice(i, 1);
  const rs = regs.sort((a, b) => val(b.valor) - val(a.valor));
  if (rs.length < 2 || !lojas.length) return null;
  // por valor vendido; empate: melhor = mais conversão; pior = mais contatos
  const top = [...lojas].sort((a, b) => val(b.valor) - val(a.valor) || b.p - a.p).slice(0, q);
  const fundo = piores([...lojas].sort((a, b) => val(a.valor) - val(b.valor) || n(b.contatos) - n(a.contatos)), top, q);
  const mil = (s) => Number(String(s).replace(/\D/g, "")).toLocaleString("pt-BR");
  const conv = (x) => ({ taxa: x.ptxt, detalhe: `${mil(x.conv)} ${n(x.conv) === 1 ? "venda" : "vendas"} de ${mil(x.contatos)} contatos` });
  const r = (x) => ({ nome: nome(x.reg), valor: x.valor, info: `${x.conv} de ${x.contatos} contatos (${x.ptxt})`, p: x.p, conv: conv(x) });
  const l = (x) => ({ nome: x.loja, reg: nome(x.reg), valor: x.valor, info: `${x.conv} de ${x.contatos} (${x.ptxt})`, p: x.p, conv: conv(x) });
  return {
    tipo: "LEADS",
    total: totalL && { valor: totalL.valor, info: `${totalL.conv} de ${totalL.contatos} contatos (${totalL.ptxt})`, conv: conv(totalL) },
    vazio: rs.every((x) => val(x.valor) === 0),
    melhor: r(rs[0]), pior: r(rs[rs.length - 1]),
    regs: rs.map(r),
    top: top.map(l), fundo: fundo.map(l),
  };
}

// texto reserva (se o card não puder ser desenhado)
export function textoRanking(d, titulo = "") {
  if (!d) return null;
  const cab = `🏆 *RANKING ${d.tipo}${titulo ? ` — ${titulo}` : ""}*`;
  if (d.vazio) return `${cab}\n\nSem vendas ainda.`;
  const loja = (x, i) => `${i + 1}º ${x.nome} (${x.reg}) — ${x.valor} — ${x.info}`;
  return [
    cab, "",
    `🥇 *Regional líder: ${d.melhor.nome}*`, `💰 ${d.melhor.valor} — ${d.melhor.info}`, "",
    `🟢⬆️ *${d.top.length} lojas líderes*`, ...d.top.map(loja), "",
    `⚠️ *Regional flop: ${d.pior.nome}*`, `💰 ${d.pior.valor} — ${d.pior.info}`,
    ...(d.fundo.length ? ["", `🔻 *${d.fundo.length === 1 ? "Loja flop" : `${d.fundo.length} lojas flop`}*`, ...d.fundo.map(loja)] : []),
  ].join("\n");
}

// texto do acumulado do mês (diretoria): blocos com título, um item por bloco, valor e % em linhas próprias
const BARRA = "━━━━━━━━━━━━━━━━━━━━";
const MEDALHA = ["🥇", "🥈", "🥉"];
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
const titulo = (emoji, txt, obs) => [BARRA, `${emoji} *${txt}*${obs ? `  _${obs}_` : ""}`, BARRA];
const regNome = (s) => s.replace(" - ", " · ");
const pctDe = (info) => info.split(" ")[0];
const resto = (info) => info.slice(info.indexOf(" ") + 1);
const linhaValor = (x) => x.conv
  ? [`      ${x.valor}  ·  conversão *${x.conv.taxa}*`, `      ${x.conv.detalhe}`]
  : [`      ${x.valor}  ·  *${pctDe(x.info)}* ${resto(x.info)}`];
function regionais(lista) {
  return lista.flatMap((x, i) => {
    return [`${MEDALHA[i] || NUM[i]} *${regNome(x.nome)}*`, ...linhaValor(x), ""];
  });
}
function lojas(lista) {
  return lista.flatMap((x, i) => [`${NUM[i]} *${x.nome.replace(/^(LOJA \d+) /, "$1 · ")}*`, `      ${regNome(x.reg)}`, ...linhaValor(x), ""]);
}
function blocoMes(d, nomeRank) {
  return [
    ...titulo("🏢", `REGIONAIS — ${nomeRank}`), "", ...regionais(d.regs || [d.melhor, d.pior]),
    ...titulo("🟢", "MAIORES VENDAS"), "", ...lojas(d.top),
    ...(d.fundo.length ? [...titulo("🔴", "MENORES VENDAS"), "", ...lojas([...d.fundo].reverse())] : []),
  ];
}
export function textoMes(d, periodo = "", hora = false) {
  if (!d) return null;
  const leads = d.tipo === "LEADS";
  const out = [`${leads ? "📋" : "📊"} *${hora ? "RESULTADO DE HOJE" : "PARCIAL DO MÊS"} — ${leads ? "LEADS" : "VENDAS"}*`, `${hora ? "🕐" : "🗓️"} _${periodo}_`, ""];
  if (d.vazio) return [...out, "Sem vendas no período."].join("\n");
  out.push(...titulo("💰", "TOTAL DA REDE"));
  if (d.total) out.push(leads ? `Vendido pelos leads: *${d.total.valor}*` : `Vendas: *${d.total.valor}*`,
    leads ? `Conversão: *${d.total.conv.taxa}*  (${d.total.conv.detalhe})` : `Atingimento: *${pctDe(d.total.info)}* da meta`);
  if (d.servicos?.total) out.push(`Serviços: *${d.servicos.total.valor}*  (${d.servicos.total.info})`);
  // mesmo formato do acumulado do mês (diretoria): 4 regionais, maiores/menores lojas e serviços
  out.push("", ...blocoMes(d, leads ? "valor vendido" : "% da meta"));
  if (d.servicos) out.push(...titulo("🛠️", "SERVIÇOS", "Sorte Dobrada + Garantia, % sobre as vendas"), "",
    ...regionais(d.servicos.regs || [d.servicos.melhor, d.servicos.pior]),
    "🟢 *Maiores em serviços*", ...d.servicos.top.map((x, i) => `${NUM[i]} ${x.nome}  ·  *${pctDe(x.info)}*`), "",
    "🔴 *Menores em serviços*", ...[...d.servicos.fundo].reverse().map((x, i) => `${NUM[i]} ${x.nome}  ·  *${pctDe(x.info)}*`), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const textoHora = (d, quando) => textoMes(d, quando, true);

// compatibilidade
export const montarRanking = (arq, titulo) => textoRanking(dadosRanking(arq), titulo);
export const montarRankingLeads = (arq, titulo) => textoRanking(dadosRankingLeads(arq), titulo);

if (process.argv[1]?.endsWith("ranking.js")) {
  const leads = process.argv[3] === "leads";
  const d = leads ? dadosRankingLeads(process.argv[2]) : dadosRanking(process.argv[2]);
  console.log((process.env.PERIODO === "mes" ? textoMes(d, "mês") : textoRanking(d)) ?? "(sem dados)");
}

// 8h: meta do dia (rede, regionais e lojas), sem ranking
export function textoMeta(arq = "saida/regional.txt", quando = "") {
  if (!fs.existsSync(arq)) return null;
  const linhas = fs.readFileSync(arq, "utf8").split("\n").map((l) => l.split(" | ").map((c) => c.trim()));
  const nomes = {};
  const arqNomes = arq.replace(/regional\.txt$/, "lojas.txt");
  if (fs.existsSync(arqNomes))
    for (const l of fs.readFileSync(arqNomes, "utf8").split("\n")) {
      const [num, nm] = l.split(" | ").map((c) => c.trim());
      if (/^\d+$/.test(num) && nm) nomes[Number(num)] = NOME_LOJA[Number(num)] || nm;
    }
  let total = null; const regs = new Map(), lojas = new Map();
  for (const c of linhas) {
    if (c[0] === "Total Geral" && !total) total = c[1];
    if (/^R[1-9]$/.test(c[0]) && !regs.has(c[0])) regs.set(c[0], c[1]);
    if (/^LOJA \d+$/i.test(c[0]) && /^R[1-9]$/.test(c[1]) && !lojas.has(c[0])) lojas.set(c[0], { reg: c[1], meta: c[2] });
  }
  if (!total || !regs.size) return null;
  const out = ["🎯 *META DO DIA*", `🗓️ _${quando}_`, "", BARRA, "💰 *META DA REDE*", BARRA, `*${total}*`, ""];
  for (const r of [...regs.keys()].sort()) {
    out.push(BARRA, `🏢 *${regNome(nome(r))}*  ·  *${regs.get(r)}*`, BARRA);
    const ls = [...lojas.entries()].filter(([, x]) => x.reg === r && val(x.meta) > 0).sort((a, b) => val(b[1].meta) - val(a[1].meta));
    for (const [lj, x] of ls) {
      const nm = nomes[Number(lj.replace(/\D/g, ""))];
      out.push(`▫️ ${lj}${nm ? ` · ${nm}` : ""}  —  *${x.meta}*`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}
