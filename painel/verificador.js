// Verificador de respostas da IA: confere cada número do texto contra os dados enviados.
// Erro = número que não existe nos dados, ou que existe mas é de outra loja/regional/vendedor
// diferente do citado na mesma frase. Usado pelo chat (Worker) e pela análise automática.
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// números com unidade: R$ (com mil/mi) e %
export function numeros(txt) {
  const t = String(txt).replace(/ /g, " "), out = [];
  for (const m of t.matchAll(/R\$\s*(-?\s*[\d.]+(?:,\d+)?)\s*(milh(?:[õo]es|[ãa]o)|mil|mi)?\b/gi)) {
    let v = parseFloat(m[1].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
    const u = (m[2] || "").toLowerCase();
    if (u === "mil") v *= 1e3; else if (u.startsWith("mi")) v *= 1e6;
    if (!isNaN(v)) out.push({ t: "R", v, raw: m[0].trim() });
  }
  for (const m of t.matchAll(/(-?\d+(?:[.,]\d+)?)\s*%/g)) {
    const v = parseFloat(m[1].replace(",", "."));
    if (!isNaN(v)) out.push({ t: "P", v, raw: m[0].trim() });
  }
  return out;
}
const igual = (a, b) => a.t === b.t && (a.t === "P" ? Math.abs(a.v - b.v) <= 0.6 : Math.abs(a.v - b.v) <= Math.max(600, Math.abs(b.v) * 0.025));

// índice: entidade -> valores; entidade "REDE" = números gerais (sem loja/regional/vendedor)
export function indice(ctx) {
  const ents = new Map();
  const ent = (id, nome, aliases, global = false) => { if (!ents.has(id)) ents.set(id, { id, nome, aliases, global, vals: [] }); return ents.get(id); };
  ent("REDE", "a rede inteira", {}, true);
  const GLOBAIS = ["categorias", "categoriasMes", "grupos", "marcas", "pagamentos", "produtos", "servicos", "servicosMes"];
  const lojaDe = (s) => {
    const n = norm(s), m = n.match(/^(\d{1,3})\s*[·.\-]?\s*(.*)$/), num = m ? String(Number(m[1])) : "", nome = (m ? m[2] : n).trim();
    return ent("LOJA:" + (num || nome), s, { num, nome });
  };
  const walk = (o, dono, chave = "") => {
    if (Array.isArray(o)) return o.forEach((x) => walk(x, dono, chave));
    if (!o || typeof o !== "object") return;
    let e = dono;
    if (GLOBAIS.includes(chave)) e = ent("GLOBAL:" + chave + ":" + norm(o.nome || chave), `${o.nome || chave} (número da rede inteira)`, {}, true);
    else if (typeof o.loja === "string" && !o.nome) e = lojaDe(o.loja);
    else if (typeof o.nome === "string" && (o.venda !== undefined || o.pedidos !== undefined) && o.nome.split(" ").length >= 2 && !/^R\d$/.test(o.nome)) {
      const w = norm(o.nome).split(" ").filter((x) => x.length > 2);
      e = ent("VEND:" + norm(o.nome), o.nome, { vend: [w.slice(0, 2).join(" "), w.length > 2 ? `${w[0]} ${w[w.length - 1]}` : ""].filter(Boolean) });
    } else if (typeof o.reg === "string" && /^R\d$/.test(o.reg)) e = ent("REG:" + o.reg, o.reg, { reg: o.reg, lider: norm(o.lider || "") });
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") e.vals.push(...numeros(v));
      else if (v && typeof v === "object") walk(v, e, k);
    }
  };
  walk(ctx, ents.get("REDE"));
  return [...ents.values()];
}

function citadas(linha, ents) {
  const L = " " + norm(linha).replace(/[·\-–—()]/g, " ") + " ";
  return ents.filter((e) => {
    const a = e.aliases;
    if (a.reg) return new RegExp(`\\b${a.reg}\\b`).test(L) || (a.lider && L.includes(" " + a.lider + " "));
    if (a.vend) return a.vend.some((x) => L.includes(" " + x + " ") || L.includes(" " + x));
    if (!a || e.global) return false;
    if (a.nome !== undefined) return (a.nome && a.nome.length > 3 && L.includes(" " + a.nome)) || (a.num && new RegExp(`\\bLOJA\\s*0*${a.num}\\b|\\b0*${a.num}\\s+${a.nome.split(" ")[0]}`).test(L));
    return false;
  });
}

// devolve a lista de erros (vazia = tudo confere)
export function verificar(texto, ctx, idx = indice(ctx)) {
  const erros = [];
  const linhas = String(texto).split(/\n|(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9*•-])/).map((l) => l.trim()).filter(Boolean);
  for (const linha of linhas) {
    const ns = numeros(linha);
    if (!ns.length) continue;
    const est = /estimativ|aproximad|cerca de|≈|~/i.test(linha);
    const E = citadas(linha, idx);
    const falaDaRede = /\b(rede|geral|todas as lojas|total|consolidad|empresa|categoria|grupo|marca)\b/i.test(linha);
    for (const n of ns) {
      const donos = idx.filter((e) => e.vals.some((v) => igual(n, v)));
      if (!donos.length) { if (!est) erros.push({ linha, valor: n.raw, motivo: "esse valor não existe nos dados" }); continue; }
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
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
