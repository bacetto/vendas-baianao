// Cifra o dados.json com senha (AES-256-GCM + PBKDF2) -> dados.enc. Uso: SENHA=... node painel/cifrar.js entrada.json saida.enc
import fs from "node:fs"; import zlib from "node:zlib"; import crypto from "node:crypto";
const [,, ent, sai] = process.argv; const senha = process.env.SENHA; if (!senha) throw new Error("Falta SENHA");
const iter = 600000, salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const k = crypto.pbkdf2Sync(senha, salt, iter, 32, "sha256");
const c = crypto.createCipheriv("aes-256-gcm", k, iv);
const d = Buffer.concat([c.update(zlib.gzipSync(fs.readFileSync(ent))), c.final(), c.getAuthTag()]);
fs.writeFileSync(sai, JSON.stringify({ iter, salt: salt.toString("base64"), iv: iv.toString("base64"), dados: d.toString("base64") }));
