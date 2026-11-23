// Guarda as regras e o histórico CRIPTOGRAFADOS (senha = PAINEL_SENHA) no ramo "aprovacao" do repositório.
// Repositório público: sem a senha ninguém lê nada.
import crypto from "node:crypto";
import { estadoInicial } from "./regras.js";

const RAMO = "aprovacao", ARQ = "estado.enc";
const { GH_TOKEN, REPO, SENHA } = process.env;
const gh = (path, opt = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  ...opt, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "aprovacao", ...(opt.headers || {}) },
});

function cifrar(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const k = crypto.pbkdf2Sync(SENHA, salt, 200000, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const b = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]);
  return JSON.stringify({ v: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), dados: b.toString("base64") });
}
function decifrar(txt) {
  const e = JSON.parse(txt), b = Buffer.from(e.dados, "base64");
  const k = crypto.pbkdf2Sync(SENHA, Buffer.from(e.salt, "base64"), 200000, 32, "sha256");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(0, -16)), d.final()]).toString());
}

let sha = null;
export async function carregar() {
  if (!GH_TOKEN || !REPO || !SENHA) throw new Error("Faltam GH_TOKEN/REPO/SENHA");
  const r = await gh(`/contents/${ARQ}?ref=${RAMO}`);
  if (r.status === 404) return estadoInicial();
  if (!r.ok) throw new Error(`estado: GitHub respondeu ${r.status}`);
  const j = await r.json();
  sha = j.sha;
  return { ...estadoInicial(), ...decifrar(Buffer.from(j.content, "base64").toString()) };
}

async function garantirRamo() {
  const r = await gh(`/git/ref/heads/${RAMO}`);
  if (r.ok) return;
  const main = await (await gh(`/git/ref/heads/main`)).json();
  await gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${RAMO}`, sha: main.object.sha }) });
}

export async function salvar(estado) {
  // histórico curto: últimos 300 eventos / avisos dos últimos 3 dias
  estado.historico = (estado.historico || []).slice(-300);
  const corte = Date.now() - 3 * 864e5;
  for (const [k, t] of Object.entries(estado.avisados || {})) if (t < corte) delete estado.avisados[k];
  for (let t = 0; t < 3; t++) {
    if (!sha) await garantirRamo();
    const r = await gh(`/contents/${ARQ}`, { method: "PUT", body: JSON.stringify({
      message: "estado", branch: RAMO, content: Buffer.from(cifrar(estado)).toString("base64"), ...(sha ? { sha } : {}),
    }) });
    if (r.ok) { sha = (await r.json()).content.sha; return true; }
    if (r.status === 409 || r.status === 422) { const g = await gh(`/contents/${ARQ}?ref=${RAMO}`); sha = g.ok ? (await g.json()).sha : null; continue; }
    console.log(`⚠️ estado não salvo (${r.status})`);
    return false;
  }
  return false;
}
