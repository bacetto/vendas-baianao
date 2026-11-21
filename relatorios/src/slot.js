// Decide O QUE mandar agora (e se já foi mandado). Sem dependências: roda antes do npm ci.
// Horários (Salvador):
//   06:50  mes     -> acumulado do mês até ontem (Ednilson), chega antes das 7h
//   08:00  meta    -> meta do dia (grupo)
//   10..20 parcial -> parcial do dia de 2 em 2h + categorias (grupo)
//   22:20  final   -> resultado final do dia + categorias (grupo)
// Qualquer gatilho (cron-job.org, agendamento do GitHub, push no ramo disparo, Claude) pode chamar:
// quem chegar primeiro dentro da janela manda; os outros pulam. Fora da janela não manda nada.
import fs from "node:fs";

const GRUPO = "LÍDERES REGIONAL";
const EDNILSON = (process.env.EDNILSON_NUM || "");
const SLOTS = [
  { modo: "mes", h: 6, m: 50, janela: 190, destino: EDNILSON },
  { modo: "meta", h: 8, m: 0, janela: 90, destino: GRUPO },
  ...[10, 12, 14, 16, 18, 20].map((h) => ({ modo: "parcial", h, m: 0, janela: 50, destino: GRUPO })),
  { modo: "final", h: 22, m: 20, janela: 99, destino: GRUPO },
];
const ANTES = 8; // chegou até 8 min antes: espera o horário cravado
const MARCAS = "sessao/enviados.txt";

const chaveDe = (d, s) => `${d.toISOString().slice(0, 10)} ${s.modo} ${String(s.h).padStart(2, "0")}:${String(s.m).padStart(2, "0")}`;
const mesmoDestino = (a, b) => { const da = a.replace(/\D/g, ""), db = b.replace(/\D/g, "");
  if (da.length >= 10 && db.length >= 10) return (da.startsWith("55") ? da : `55${da}`) === (db.startsWith("55") ? db : `55${db}`);
  return a.trim().toLowerCase() === b.trim().toLowerCase(); };
const bahia = () => new Date(Date.now() - 3 * 3600e3);
const minDia = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
const out = (k, v) => fs.appendFileSync(process.env.GITHUB_OUTPUT || "/dev/null", `${k}=${v}\n`);
const enviados = () => { try { return fs.readFileSync(MARCAS, "utf8").split("\n").map((l) => l.trim()); } catch { return []; } };

const acao = process.env.ACAO || "auto";            // auto | enviar | meta | final | mes-enviar
const destinoManual = (process.env.DESTINO_MANUAL || "").trim();
const forcado = { enviar: "parcial", meta: "meta", final: "final", "mes-enviar": "mes" }[acao];

let agora = bahia();
let slot;
if (forcado) {
  // manual: manda na hora. Só conta como "o envio do dia" se for pro destino padrão no horário do slot.
  const cands = SLOTS.filter((s) => s.modo === forcado);
  slot = cands.reduce((a, s) => (Math.abs(minDia(agora) - (s.h * 60 + s.m)) < Math.abs(minDia(agora) - (a.h * 60 + a.m)) ? s : a));
  if (forcado === "parcial") slot = { ...slot, h: agora.getUTCHours(), m: 0 };
} else {
  // janelas podem se sobrepor (ex.: 7h atrasado e 8h): manda o mais recente que ainda não foi;
  // o mais antigo pendente fica pro próximo gatilho, enquanto estiver na janela
  const n = minDia(agora), ja = enviados();
  const abertos = SLOTS.filter((s) => { const t = s.h * 60 + s.m; return n >= t - ANTES && n < t + s.janela; });
  slot = [...abertos].reverse().find((s) => !ja.includes(chaveDe(agora, s))) || abertos[0];
  if (!slot) {
    console.log(`Fora de qualquer janela (${agora.toISOString().slice(11, 16)} em Salvador). Nada a fazer.`);
    // era uma nova tentativa depois de falha e o horário passou: avisa que desistiu
    if (Number(process.env.TENTATIVA || 0) > 0) { out("pular", "false"); out("desistiu", "true"); } else out("pular", "true");
    process.exit(0);
  }
}
// chegou uns minutos antes: espera o horário cravado
const falta = (slot.h * 60 + slot.m - minDia(agora)) * 60e3 - agora.getUTCSeconds() * 1e3;
if (falta > 0 && falta <= ANTES * 60e3) { console.log(`Esperando ${slot.h}:${String(slot.m).padStart(2, "0")} (${Math.round(falta / 1000)}s)...`); await new Promise((r) => setTimeout(r, falta + 2000)); agora = bahia(); }

const destino = destinoManual || slot.destino;
const chave = chaveDe(agora, slot);
const oficial = mesmoDestino(destino, slot.destino) && (!forcado || Math.abs(minDia(agora) - (slot.h * 60 + slot.m)) < slot.janela);
if (oficial && enviados().includes(chave)) { console.log(`Já enviado: ${chave}. Pulando.`); out("pular", "true"); process.exit(0); }

console.log(`▶ ${chave} → ${destino}${oficial ? "" : " (avulso, não marca)"}`);
out("pular", "false");
out("modo", slot.modo);
out("destino", destino);
out("hora", `${String(slot.h).padStart(2, "0")}h`);
out("chave", oficial ? chave : "");
