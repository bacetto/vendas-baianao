// Aviso no WhatsApp (falha / resolvido). Uso: node src/alerta.js "texto"
import { conectar, acharDestino } from "./whats.js";

const para = process.env.ALERTA_PARA || "5571981053362";
const texto = process.argv.slice(2).join(" ").trim();
if (!texto) process.exit(0);
const sock = await conectar({ timeoutMs: 90000 });
await new Promise((r) => setTimeout(r, 5000));
await sock.sendMessage(await acharDestino(sock, para), { text: texto });
console.log("✅ Aviso enviado:", texto);
await new Promise((r) => setTimeout(r, 5000));
await sock.end?.();
process.exit(0);
