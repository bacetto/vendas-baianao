// 27/11: ao (re)ligar a coleta, recupera a última base completa (raw.json) guardada criptografada no ramo "dados-raw".
// Assim a coleta volta direto na leitura LEVE (rápida), sem depender da leitura pesada do mês — que falha quando o portal está lento.
import fs from "node:fs"; import zlib from "node:zlib"; import crypto from "node:crypto";
const { REPO, SENHA } = process.env;
try {
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/dados-raw/raw.enc?t=${Date.now()}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const e = await r.json(), b = Buffer.from(e.dados, "base64");
  const k = crypto.pbkdf2Sync(SENHA, Buffer.from(e.salt, "base64"), e.iter, 32, "sha256");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(e.iv, "base64"));
  d.setAuthTag(b.subarray(-16));
  const txt = zlib.gunzipSync(Buffer.concat([d.update(b.subarray(0, -16)), d.final()]));
  JSON.parse(txt);
  fs.mkdirSync("saida", { recursive: true });
  fs.writeFileSync("saida/raw.json", txt);
  console.log("✅ base completa anterior recuperada");
} catch (e) { console.log("base anterior não recuperada:", String(e.message).slice(0, 80)); }
