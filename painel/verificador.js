// Verificador de respostas da IA: confere cada número do texto contra os dados enviados.
// Erro = número que não existe nos dados, ou que existe mas é de outra loja/regional/vendedor
// diferente do citado na mesma frase. Usado pelo chat (Worker) e pela análise automática.
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// números com unidade: R$ (com mil/mi) e %
export function numeros(txt) {
  const t = String(txt).replace(/\u00a0/g, " ").replace(/[\u2010-\u2015\u2212]/g, "-"), out = [];
  for (const m of t.matchAll(/(-\s*)?R\$\s*(-?\s*[\d.]+(?:,\d+)?)\s*(milh(?:[õo]es|[ãa]o)|mil|mi)?\b/gi)) {
    let v = parseFloat(m[2].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
    if (m[1] && v > 0) v = -v;
    const u = (m[3] || "").toLowerCase();
    if (u === "mil") v *= 1e3; else if (u.startsWith("mi")) v *= 1e6;
    if (!isNaN(v)) out.push({ t: "R", v, raw: m[0].trim() });
  }
  for (const m of t.matchAll(/(-?\d+(?:[.,]\d+)?)\s*%/g)) {
    const v = parseFloat(m[1].replace(",", "."));
    if (!isNaN(v)) out.push({ t: "P", v, raw: m[0].trim(), inteiro: !/[.,]/.test(m[1]) });
  }
  return out;
}
// período de um trecho de texto (ou do nome de um campo dos dados)
const PER = [["mesPassado", /\b(m[eê]s passado|m[eê]s anterior|outubro|setembro|agosto|julho|junho|maio|abril|mar[cç]o|fevereiro|janeiro|dezembro)\b/i],
  ["ontem", /\bontem\b/i], ["hoje", /\b(hoje|do dia|no dia|agora)\b/i], ["mes", /\b(m[eê]s|mensal|acumulad|novembro)\b/i]];
export const periodoTexto = (t0) => {
  const t = String(t0).replace(/\bat[eé]\s+(o\s+dia\s+de\s+)?hoje\b/gi, " ").replace(/\bat[eé]\s+ontem\b/gi, " mês "); // "meta até hoje" é do mês, não de hoje
  const achou = PER.filter(([, re]) => re.test(t)).map(([p]) => p);
  if (achou.includes("hoje") && achou.includes("mes")) return ""; // frase mistura hoje e mês: não julga pelo período
  return achou[0] || "";
};
const periodoChave = (k) => ({ hoje: "hoje", ontem: "ontem", mes: "mes", mesAteHoje: "mes", mesAteOntem: "mes", mesF: "mes", mesPassado: "mesPassado", mesAnt: "mesPassado" })[k] || "";
const igual = (a, b) => a.t === b.t && (a.t === "P" ? Math.abs(a.v - b.v) <= (a.inteiro || b.inteiro ? 1 : 0.6) : Math.abs(a.v - b.v) <= Math.max(600, Math.abs(b.v) * 0.025));

// índice: entidade -> valores; entidade "REDE" = números gerais (sem loja/regional/vendedor)
export function indice(ctx) {
  const ents = new Map();
  const ent = (id, nome, aliases, global = false) => { if (!ents.has(id)) ents.set(id, { id, nome, aliases, global, vals: [] }); return ents.get(id); };
  ent("REDE", "a rede inteira", {}, true);
  const GLOBAIS = ["categorias", "categoriasMes", "categoriasMesAteOntem", "grupos", "marcas", "pagamentos", "produtos", "servicos", "servicosMes"];
  const lojaDe = (s) => {
    const n = norm(s), m = n.match(/^(\d{1,3})\s*[·.\-]?\s*(.*)$/), num = m ? String(Number(m[1])) : "", nome = (m ? m[2] : n).trim();
    return ent("LOJA:" + (num || nome), s, { num, nome });
  };
  const walk = (o, dono, chave = "", per = "") => {
    per = periodoChave(chave) || per;
    if (Array.isArray(o)) return o.forEach((x) => walk(x, dono, chave, per));
    if (!o || typeof o !== "object") return;
    let e = dono;
    if (GLOBAIS.includes(chave)) e = ent("GLOBAL:" + chave + ":" + norm(o.nome || chave), `${o.nome || chave} (número da rede inteira)`, {}, true);
    else if (typeof o.loja === "string" && !o.nome) e = lojaDe(o.loja);
    else if (typeof o.nome === "string" && (o.venda !== undefined || o.pedidos !== undefined) && o.nome.split(" ").length >= 2 && !/^R\d$/.test(o.nome)) {
      const todas = norm(o.nome).split(" ").filter(Boolean), w = todas.filter((x) => x.length > 2);
      e = ent("VEND:" + norm(o.nome), o.nome, { vend: { full: todas.join(" "), dois: todas.slice(0, 2).join(" "), first: w[0] || "", outros: w.slice(1) } });
    } else if (typeof o.reg === "string" && /^R\d$/.test(o.reg)) e = ent("REG:" + o.reg, o.reg, { reg: o.reg, lider: norm(o.lider || "") });
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") e.vals.push(...numeros(v).map((n) => ({ ...n, per })));
      else if (v && typeof v === "object") walk(v, e, k, per);
    }
  };
  walk(ctx, ents.get("REDE"));
  const lista = [...ents.values()], conta = {};
  for (const e of lista) if (e.aliases?.vend?.first) conta[e.aliases.vend.first] = (conta[e.aliases.vend.first] || 0) + 1;
  for (const e of lista) if (e.aliases?.vend) e.aliases.vend.unico = e.aliases.vend.first.length > 3 && conta[e.aliases.vend.first] === 1;
  return lista;
}

function citadas(linha, ents) {
  const achadas = citadas0(linha, ents);
  // duas lojas com o mesmo nome (ex.: 11 e 22 CAMACARI): se a linha deu o número, vale só a do número
  const porNum = achadas.filter((e) => e.aliases?.num && new RegExp(`\\b0*${e.aliases.num}\\b`).test(linha));
  const nomesNum = new Set(porNum.map((e) => e.aliases.nome));
  return achadas.filter((e) => !(e.aliases?.nome !== undefined && nomesNum.has(e.aliases.nome) && !porNum.includes(e)));
}
function citadas0(linha, ents) {
  const L = " " + norm(linha).replace(/[·\-–—()*,;:!?"'/|]|\.(?=\s|$)/g, " ").replace(/\s+/g, " ") + " ";
  return ents.filter((e) => {
    const a = e.aliases;
    if (a.reg) return new RegExp(`\\b${a.reg}\\b`).test(L) || (a.lider && L.includes(" " + a.lider + " "));
    if (a.vend) { const v = a.vend; // nome completo, os 2 primeiros nomes, ou primeiro nome + qualquer sobrenome
      return L.includes(" " + v.full) || (v.dois.includes(" ") && L.includes(" " + v.dois + " ")) || (v.first && L.includes(" " + v.first + " ") && (v.unico || v.outros.some((x) => L.includes(" " + x + " ")))); }
    if (!a || e.global) return false;
    if (a.nome !== undefined) return (a.nome && a.nome.length > 3 && L.includes(" " + a.nome)) || (a.num && new RegExp(`\\bLOJA\\s*0*${a.num}\\b|\\b0*${a.num}\\s+${a.nome.split(" ")[0]}`).test(L));
    return false;
  });
}

// devolve a lista de erros (vazia = tudo confere)
export function verificar(texto, ctx, idx = indice(ctx)) {
  const erros = [];
  const linhas = String(texto).split(/\n|(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9*•-])/).map((l) => l.trim()).filter(Boolean);
  let assunto = [], perAssunto = ""; // linhas sem nome/período (ex.: linhas de tabela) herdam os do assunto anterior
  for (const linha of linhas) {
    const citou = citadas(linha, idx);
    const perLinha = periodoTexto(linha);
    const titulo = /^\s*(#{1,4}\s|\*\*[^*]{1,40}\*\*\s*[:–-]?\s*$)/.test(linha) || (/^\s*\*\*[^*]{1,40}\*\*/.test(linha) && linha.length < 60);
    if (titulo) { assunto = citou; perAssunto = perLinha; }
    if (citou.length) assunto = citou;
    if (perLinha) perAssunto = perLinha;
    const P = perLinha || perAssunto;
    const ns = numeros(linha);
    if (!ns.length) continue;
    const est = /estimativ|aproximad|cerca de|≈|~/i.test(linha);
    const E = citou.length ? citou : assunto;
    const falaDaRede = /\b(rede|geral|todas as lojas|total|consolidad|empresa|categoria|grupo|marca)\b/i.test(linha);
    for (const n of ns) {
      const donos = idx.filter((e) => e.vals.some((v) => igual(n, v)));
      if (!donos.length) { if (!est) erros.push({ linha, valor: n.raw, motivo: "esse valor não existe nos dados" }); continue; }
      // mesmo dono, período errado (ex.: meta de HOJE apresentada como do MÊS)
      if (P && E.length) {
        const dele = E.flatMap((d) => d.vals.filter((v) => igual(n, v)));
        if (dele.length && dele.every((v) => v.per && v.per !== P)) {
          erros.push({ linha, valor: n.raw, motivo: `é número de ${dele[0].per === "mes" ? "o mês" : dele[0].per === "mesPassado" ? "o mês passado" : dele[0].per} de ${E.map((e) => e.nome).join(" / ")}, não de ${P === "mes" ? "o mês" : P === "mesPassado" ? "o mês passado" : P}` });
          continue;
        }
      }
      if (E.length && !donos.some((d) => E.includes(d)) && donos.every((d) => d.global) && !falaDaRede)
        erros.push({ linha, valor: n.raw, motivo: `é número da rede inteira (${donos.slice(0, 2).map((d) => d.nome).join(" / ")}), não de ${E.map((e) => e.nome).join(" / ")}` });
      else if (E.length && !donos.some((d) => E.includes(d) || d.global))
        erros.push({ linha, valor: n.raw, motivo: `não é de ${E.map((e) => e.nome).join(" / ")}; nos dados esse valor é de ${donos.slice(0, 3).map((d) => d.nome).join(" / ")}` });
    }
  }
  return erros;
}

export const textoErros = (erros) => erros.map((e) => `- Trecho: "${e.linha.slice(0, 220)}" → o valor ${e.valor} ${e.motivo}.`).join("\n");

// remove as frases com número errado (última linha de defesa)
export function limpar(texto, erros) {
  let t = String(texto);
  for (const e of erros) t = t.split(e.linha).join("");
  return t.split("\n").filter((l) => !/^\s*(\d+[.)]|[-•*]|\|[\s|:-]*)\s*$/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
