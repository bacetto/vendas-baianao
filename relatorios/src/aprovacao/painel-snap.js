// Detalhe de cada loja (vendido bruto, devoluções e nº de pedidos) num horário: vem do painel de vendas
// (coleta com o login do Gabriel, publicada cifrada a cada ~1 min no ramo "dados"). O GitHub guarda cada publicação,
// então dá pra pegar a do horário exato da leitura, inclusive de uma leitura que já passou.
import crypto from "node:crypto";
import zlib from "node:zlib";
const { GH_TOKEN, REPO, SENHA } = process.env;
const gh = (path, accept = "application/vnd.github+json") => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: accept, "User-Agent": "aprovacao" } });

// publicação do painel mais próxima ANTES de "alvoMs" (até 1 min depois, pra não perder a leitura da hora cheia)
async function versaoAte(alvoMs) {
  const r = await gh(`/activity?ref=refs/heads/dados&per_page=100`);
  if (!r.ok) throw new Error("histórico do painel: " + r.status);
  const l = (await r.json()).map((x) => ({ t: Date.parse(x.timestamp), sha: x.after })).filter((x) => x.sha && x.t <= alvoMs + 60e3).sort((a, b) => b.t - a.t);
  if (!l.length || alvoMs - l[0].t > 15 * 60e3) throw new Error("sem publicação do painel perto do horário");
  return l[0];
}
async function abrir(sha) {
  const r = await gh(`/contents/dados.enc?ref=${sha}`, "application/vnd.github.raw");
  if (!r.ok) throw new Error("dados do painel: " + r.status);
  const e = await r.json(), b = Buffer.from(e.dados, "base64");
  const k = await new Promise((ok, no) => crypto.pbkdf2(SENHA, Buffer.from(e.salt, "base64"), e.iter, 32, "sha256", (er, x) => (er ? no(er) : ok(x))));
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(b.subarray(0, -16)), d.final()])));
}
// { num: { b, d, p } } da venda de HOJE no horário pedido
export async function detalheLojas(alvoMs, dia) {
  const v = await versaoAte(alvoMs);
  const D = await abrir(v.sha);
  const h = D.periodos?.hoje;
  if (!h || h.inicio !== dia) throw new Error("painel ainda sem os dados de hoje");
  const out = {};
  const num = (cod) => D.lojas?.[cod]?.num || Number(String(cod).slice(-4)) || 0;
  for (const x of h.vendedores || []) { const n = num(x.loja); if (!n) continue; const o = (out[n] ||= { b: 0, d: 0, p: 0 }); o.b += (x.venda || 0) - (x.devol || 0); o.d += Math.abs(x.devol || 0); }
  for (const [cod, p] of Object.entries(h.pedidosPorLoja || {})) { const n = num(cod); if (n) (out[n] ||= { b: 0, d: 0, p: 0 }).p = p; }
  return { em: v.t, lojas: out };
}
