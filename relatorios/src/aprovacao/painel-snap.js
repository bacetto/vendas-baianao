// Números do painel de vendas num horário: a coleta (login do Gabriel) publica cifrado a cada ~1 min no ramo "dados"
// e o GitHub guarda cada publicação -> dá pra pegar a de qualquer horário de hoje, inclusive de uma leitura que já passou.
//   detalheLojas: vendido bruto, devoluções e nº de pedidos de cada loja (boletim "Lojas abaixo de R$ 5 mil")
//   leadsLojas:   contatos com leads de cada loja (boletim "Lojas com menos de 3 contatos de leads")
import crypto from "node:crypto";
import zlib from "node:zlib";
const { GH_TOKEN, REPO, SENHA } = process.env;
const gh = (url, accept = "application/vnd.github+json") => fetch(url.startsWith("http") ? url : `https://api.github.com/repos/${REPO}${url}`, {
  headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: accept, "User-Agent": "aprovacao" } });

// publicação do painel mais próxima ANTES de "alvoMs" (aceita até 1 min depois, pra pegar a leitura da hora cheia)
async function versaoAte(alvoMs) {
  let url = `/activity?ref=refs/heads/dados&per_page=100`, melhor = null;
  for (let pg = 0; pg < 12 && url; pg++) {            // ~100 publicações por página (~1h40): até ~20h pra trás
    const r = await gh(url);
    if (!r.ok) throw new Error("histórico do painel: " + r.status);
    const l = (await r.json()).map((x) => ({ t: Date.parse(x.timestamp), sha: x.after })).filter((x) => x.sha);
    for (const x of l) if (x.t <= alvoMs + 60e3 && (!melhor || x.t > melhor.t)) melhor = x;
    if (melhor || !l.length || Math.min(...l.map((x) => x.t)) <= alvoMs) break;
    url = ((r.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/) || [])[1] || null;
  }
  if (!melhor || alvoMs - melhor.t > 15 * 60e3) throw new Error("sem publicação do painel perto do horário");
  return melhor;
}
const cache = new Map();
async function abrir(sha) {
  if (cache.has(sha)) return cache.get(sha);
  const r = await gh(`/contents/dados.enc?ref=${sha}`, "application/vnd.github.raw");
  if (!r.ok) throw new Error("dados do painel: " + r.status);
  const e = await r.json(), b = Buffer.from(e.dados, "base64");
  const k = await new Promise((ok, no) => crypto.pbkdf2(SENHA, Buffer.from(e.salt, "base64"), e.iter, 32, "sha256", (er, x) => (er ? no(er) : ok(x))));
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
  d.setAuthTag(b.subarray(-16));
  const D = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(0, -16)), d.final()])));
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  cache.set(sha, D);
  return D;
}
async function painelEm(alvoMs, dia) {
  const v = await versaoAte(alvoMs);
  const D = await abrir(v.sha);
  if (D.periodos?.hoje?.inicio !== dia) throw new Error("painel ainda sem os dados de hoje");
  return { em: v.t, D };
}
const numDe = (D, cod) => D.lojas?.[cod]?.num || Number(String(cod).slice(-4)) || 0;

// { em, lojas: { num: { b, d, p } } }
export async function detalheLojas(alvoMs, dia) {
  const { em, D } = await painelEm(alvoMs, dia), h = D.periodos.hoje, out = {};
  for (const x of h.vendedores || []) { const n = numDe(D, x.loja); if (!n) continue; const o = (out[n] ||= { b: 0, d: 0, p: 0 }); o.b += (x.venda || 0) - (x.devol || 0); o.d += Math.abs(x.devol || 0); }
  for (const [cod, p] of Object.entries(h.pedidosPorLoja || {})) { const n = numDe(D, cod); if (n) (out[n] ||= { b: 0, d: 0, p: 0 }).p = p; }
  return { em, lojas: out };
}
// { em, contatos: { num: contatos de leads hoje até ali }, abertas: { num: { reg, nome } } (lojas R1–R4 com meta hoje) }
export async function leadsLojas(alvoMs, dia) {
  const { em, D } = await painelEm(alvoMs, dia), h = D.periodos.hoje, contatos = {}, abertas = {};
  for (const l of D.leads?.hoje?.porLoja || []) if (l.num) contatos[l.num] = (contatos[l.num] || 0) + (Number(l.contatos) || 0);
  for (const l of h.resumo?.lojas || []) { const lj = D.lojas?.[l.cod]; if (lj && /^R[1-4]$/.test(lj.regional) && (l.meta || 0) > 0) abertas[lj.num] = { reg: lj.regional, nome: lj.nome || `Loja ${lj.num}` }; }
  return { em, contatos, abertas };
}
