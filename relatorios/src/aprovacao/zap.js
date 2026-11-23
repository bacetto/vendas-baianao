// WhatsApp do robô de descontos: aparelho conectado PRÓPRIO (pasta sessao-aprov), separado do dos relatórios,
// pra os dois poderem rodar ao mesmo tempo. Conexão de longa duração: reconecta sozinho e reenvia o que ficou na fila.
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason, jidNormalizedUser } from "@whiskeysockets/baileys";
import pino from "pino";

for (const k of ["log", "info", "warn"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (typeof a[0] === "string" && /session|SessionEntry|prekey|ratchet/i.test(a[0])) return; orig(...a); };
}

const so = (j) => String(j || "").split("@")[0].split(":")[0];

export async function zap({ pasta = "sessao-aprov", onTexto } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(pasta);
  if (!state.creds.registered) throw new Error("WhatsApp do robô ainda não foi conectado (ação conectar-whatsapp-robo)");
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  const fila = [], meus = new Set();
  let sock = null, aberto = false, fim = false, primeiro;
  const pronto = new Promise((r) => (primeiro = r));

  const abrir = () => {
    sock = makeWASocket({ version, auth: state, logger: pino({ level: "silent" }), browser: Browsers.windows("Edge"), markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u) => {
      if (u.connection === "open") { aberto = true; console.log("✅ WhatsApp do robô conectado"); primeiro(); esvaziar(); }
      if (u.connection === "close") {
        aberto = false;
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { console.log("❌ WhatsApp do robô foi desconectado do celular"); fim = true; return; }
        if (!fim) setTimeout(abrir, 3000);
      }
    });
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        if (!m?.message || meus.has(m.key.id)) continue;
        const txt = m.message.conversation || m.message.extendedTextMessage?.text || "";
        if (!txt) continue;
        const eu = [so(sock.user?.id), so(sock.user?.lid)];
        const de = [so(m.key.remoteJid), so(m.key.remoteJidAlt), so(m.key.senderPn)];
        const conversaComigo = m.key.fromMe && de.some((x) => x && eu.includes(x));
        onTexto?.(txt, { conversaComigo, de: de.filter(Boolean), fromMe: !!m.key.fromMe });
      }
    });
  };

  let enviando = false;
  async function esvaziar() {
    if (enviando) return;
    enviando = true;
    try { while (aberto && fila.length) {
      const { para, texto } = fila[0];
      try {
        const jid = para === "eu" ? jidNormalizedUser(sock.user.id) : `${para.replace(/\D/g, "").replace(/^(?!55)/, "55")}@s.whatsapp.net`;
        const r = await sock.sendMessage(jid, { text: texto });
        if (r?.key?.id) meus.add(r.key.id);
        fila.shift();
      } catch (e) { console.log("⚠️ envio falhou, tento de novo:", String(e.message).slice(0, 80)); await new Promise((r) => setTimeout(r, 5000)); }
    } } finally { enviando = false; }
  }

  abrir();
  await Promise.race([pronto, new Promise((_, rej) => setTimeout(() => rej(new Error("Tempo esgotado conectando no WhatsApp")), 120000))]);
  return {
    enviar: (para, texto) => { fila.push({ para, texto }); esvaziar(); },
    pendentes: () => fila.length,
    desconectado: () => fim,
    fechar: async () => { for (let i = 0; i < 20 && fila.length && aberto; i++) await new Promise((r) => setTimeout(r, 1000)); fim = true; await new Promise((r) => setTimeout(r, 3000)); try { sock.end?.(); } catch {} },
  };
}
