// Plano B: se o portal não responder à meia-noite, usa a última leitura do painel (dados.enc do ramo "dados").
// Uso: SENHA=... REPO=dono/repo node analise/abrir.mjs saida/dados.json
import fs from "node:fs"; import crypto from "node:crypto"; import zlib from "node:zlib";
const r = await fetch(`https://raw.githubusercontent.com/${process.env.REPO}/dados/dados.enc?t=${Date.now()}`);
if (!r.ok) throw new Error("dados.enc não baixou: " + r.status);
const e = await r.json(), b = Buffer.from(e.dados, "base64");
const k = crypto.pbkdf2Sync(process.env.SENHA, Buffer.from(e.salt, "base64"), e.iter, 32, "sha256");
const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
d.setAuthTag(b.subarray(-16));
fs.mkdirSync("saida", { recursive: true });
fs.writeFileSync(process.argv[2], zlib.gunzipSync(Buffer.concat([d.update(b.subarray(0, -16)), d.final()])));
console.log("✅ usando a última leitura do painel");
