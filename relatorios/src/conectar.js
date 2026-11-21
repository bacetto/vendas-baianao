// Roda uma vez: mostra o código pra conectar o WhatsApp como aparelho
import { conectar } from "./whats.js";
const sock = await conectar({ parear: true, timeoutMs: 280000 });
await new Promise((r) => setTimeout(r, 15000)); // deixa salvar as chaves
await sock.end?.();
console.log("✅ Pronto. Sessão salva.");
process.exit(0);
