// Conexão com o WhatsApp (aparelho conectado ao número de trabalho)
import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "node:fs";

const ARQ_CONTATOS = "sessao/contatos.json";
const contatos = (() => { try { return JSON.parse(fs.readFileSync(ARQ_CONTATOS, "utf8")); } catch { return {}; } })();

// a biblioteca de criptografia imprime chaves no console; não deixa isso ir pro registro
for (const k of ["log", "info", "warn"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (typeof a[0] === "string" && /session|SessionEntry|prekey|ratchet/i.test(a[0])) return; orig(...a); };
}

export const NUMERO = (process.env.WHATS_NUMERO || "5571981053362").replace(/\D/g, "");

export async function conectar({ parear = false, timeoutMs = 120000 } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState("sessao");
  if (!state.creds.registered && !parear) throw new Error("WhatsApp ainda não foi conectado. Rode a ação 'Conectar WhatsApp' primeiro.");
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  return new Promise((resolve, reject) => {
    let pedido = false;
    const timer = setTimeout(() => reject(new Error("Tempo esgotado conectando no WhatsApp")), timeoutMs);
    const abrir = () => {
      const sock = makeWASocket({
        version, auth: state, logger: pino({ level: "silent" }),
        browser: Browsers.windows("Chrome"),
        markOnlineOnConnect: false, syncFullHistory: false,
      });
      sock.ev.on("creds.update", saveCreds);
      // agenda de contatos (pra mandar pelo nome do contato, ex. "loja")
      const guardar = (cs = []) => { for (const c of cs) if (c?.id) contatos[c.id] = { ...contatos[c.id], ...Object.fromEntries(Object.entries(c).filter(([, v]) => v)) }; try { fs.writeFileSync(ARQ_CONTATOS, JSON.stringify(contatos)); } catch {} };
      sock.ev.on("contacts.upsert", guardar);
      sock.ev.on("contacts.update", guardar);
      sock.ev.on("messaging-history.set", (h) => guardar(h.contacts));
      sock.contatos = contatos;
      sock.ev.on("connection.update", async (u) => {
        if (parear && !state.creds.registered && !pedido && u.qr) {
          pedido = true;
          await new Promise((r) => setTimeout(r, 3000));
          const code = await sock.requestPairingCode(NUMERO);
          console.log("\n==============================================");
          console.log(`  CÓDIGO PARA CONECTAR:  ${code.slice(0, 4)}-${code.slice(4)}`);
          console.log("  No celular: WhatsApp > Aparelhos conectados >");
          console.log("  Conectar aparelho > Conectar com número de telefone");
          console.log("==============================================\n");
        }
        if (u.connection === "open") { clearTimeout(timer); console.log("✅ WhatsApp conectado"); resolve(sock); }
        if (u.connection === "close") {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) { clearTimeout(timer); reject(new Error("O WhatsApp desconectou este aparelho. Rode 'Conectar WhatsApp' de novo.")); }
          else if (code === DisconnectReason.restartRequired || parear) abrir(); // reconecta (normal após parear)
          else abrir();
        }
      });
    };
    abrir();
  });
}

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// destino: nome do grupo OU número de telefone
export async function acharDestino(sock, destino) {
  const so = destino.replace(/\D/g, "");
  if (so.length >= 10 && so.length === destino.replace(/[\s()+-]/g, "").length) {
    const num = so.startsWith("55") ? so : `55${so}`;
    const [r] = (await sock.onWhatsApp(num).catch(() => [])) || [];
    console.log(`Destino: número ${num}`);
    return r?.jid || `${num}@s.whatsapp.net`;
  }
  const grupos = Object.values(await sock.groupFetchAllParticipating());
  const exato = grupos.find((x) => norm(x.subject) === norm(destino));
  // contato salvo com esse nome (exato) vem antes de grupo parecido
  const ct = !exato && Object.values(sock.contatos || {}).filter((c) => /@s\.whatsapp\.net$|@lid$/.test(c.id)).find((c) => [c.name, c.notify, c.verifiedName].some((n) => norm(n) === norm(destino)));
  if (ct) { console.log(`Destino: contato ${ct.name || ct.notify} (${ct.id})`); return ct.id; }
  const g = exato || grupos.find((x) => norm(x.subject).includes(norm(destino)));
  if (!g) throw new Error(`Grupo "${destino}" não encontrado. Grupos: ${grupos.map((x) => x.subject).join(" | ")} · Contatos conhecidos: ${Object.keys(sock.contatos || {}).length}`);
  console.log(`Destino: ${g.subject}`);
  return g.id;
}
