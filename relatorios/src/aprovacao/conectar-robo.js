// Conecta o WhatsApp do robô de descontos como aparelho, com um CÓDIGO FIXO (CODIGO_PAREAR, 8 letras/números).
// O WhatsApp derruba o pedido de pareamento a cada ~2,5 min; aqui ele é refeito sozinho com o MESMO código,
// então a pessoa pode digitar a qualquer momento dentro da janela (padrão 10 min).
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "node:fs";

const PASTA = process.env.SESSAO_DIR || "sessao-aprov";
const NUMERO = (process.env.WHATS_NUMERO || "5571981053362").replace(/\D/g, "");
const CODIGO = (process.env.CODIGO_PAREAR || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const JANELA = Number(process.env.CONECTAR_MS || 600000);
if (CODIGO.length !== 8) { console.log("❌ CODIGO_PAREAR precisa ter 8 letras/números"); process.exit(1); }

const fim = Date.now() + JANELA;
const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

async function tentar() {
  fs.rmSync(PASTA, { recursive: true, force: true });
  const { state, saveCreds } = await useMultiFileAuthState(PASTA);
  return new Promise((resolve) => {
    let pedido = false, pareado = false;
    const abrir = () => {
      const sock = makeWASocket({ version, auth: state, logger: pino({ level: "silent" }), browser: Browsers.windows("Edge"), markOnlineOnConnect: false, syncFullHistory: false });
      sock.ev.on("creds.update", saveCreds);
      sock.ev.on("connection.update", async (u) => {
        if (!state.creds.registered && !pedido && u.qr) {
          pedido = true;
          await new Promise((r) => setTimeout(r, 2000));
          try { await sock.requestPairingCode(NUMERO, CODIGO); console.log(`▶ Código ${CODIGO.slice(0, 4)}-${CODIGO.slice(4)} ativo`); }
          catch (e) { console.log("⚠️ pedido de código falhou:", String(e.message).slice(0, 80)); }
        }
        if (u.connection === "open") { pareado = true; console.log("✅ WhatsApp do robô conectado"); setTimeout(() => { sock.end?.(); resolve(true); }, 15000); }
        if (u.connection === "close" && !pareado) {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.restartRequired || state.creds.registered) abrir(); // código aceito: reconecta pra concluir
          else resolve(false); // pedido venceu: começa outro
        }
      });
    };
    abrir();
  });
}

while (Date.now() < fim) {
  if (await tentar()) process.exit(0);
  console.log("▶ Renovando o pedido (mesmo código)");
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("❌ Ninguém digitou o código a tempo");
process.exit(1);
