// Robô de descontos do Ed — roda o dia todo no GitHub Actions (07h–23h de Salvador).
// A cada ~15 s lê "Orçamentos para aprovação" (login do Ed), aplica as regras que vocês mandaram pelo WhatsApp
// e avisa cada decisão no WhatsApp. Registro público: só contagens, nada de cliente/valor.
import { abrirPortal } from "./portal.js";
import { carregar, salvar } from "./estado.js";
import { zap } from "./zap.js";
import { comando, decidir, regionalDe, textoAviso, textoRegras, AJUDA, pct } from "./regras.js";

const CICLO = 15000;
const SIMULAR = process.env.SIMULAR === "1"; // teste: lê e avisa o que faria, sem aprovar/reprovar nada
const DURACAO = Number(process.env.DURACAO_MIN || 340) * 60e3;
const INICIO = Date.now();
const bahia = () => new Date(Date.now() - 3 * 3600e3);
const hoje = () => bahia().toISOString().slice(0, 10);
const hora = () => bahia().getUTCHours();
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const DEST = ["eu", ...(process.env.AVISAR_ED === "1" && process.env.EDNILSON_NUM ? [process.env.EDNILSON_NUM] : [])];
const ED = (process.env.EDNILSON_NUM || "").replace(/\D/g, "").replace(/^(?!55)/, "55");

if (hora() < 7 || hora() >= 23) { console.log("Fora do horário (07h–23h)"); process.exit(0); }

const est = await carregar();
console.log(`▶ Regras carregadas (${Object.keys(est.regras).length} regionais com regra${est.pausado ? ", pausado" : ""})`);
let sujo = false, acordar = null;
let wa = null; const antes = [];
const avisar = (t0) => { const t = SIMULAR ? `🧪 *SIMULAÇÃO* (nada foi feito no portal)\n${t0}` : t0; DEST.forEach((d) => (wa ? wa.enviar(d, t) : antes.push([d, t]))); };

wa = await zap({
  onTexto: (txt, info) => {
    // comandos: na conversa "você mesmo" do número do robô, ou vindos do Ed (se AVISAR_ED=1)
    const doEd = process.env.AVISAR_ED === "1" && ED && !info.fromMe && info.de.includes(ED);
    if (!info.conversaComigo && !doEd) return;
    const r = comando(txt, est);
    if (!r) return;
    console.log("▶ Comando recebido");
    if (r.mudou) { est.historico.push({ t: Date.now(), tipo: "comando", txt: txt.trim().slice(0, 40), quem: doEd ? "ed" : "eu" }); sujo = true; acordar?.(); }
    avisar(r.resposta);
  },
});
for (const [d, t] of antes.splice(0)) wa.enviar(d, t);

if (!SIMULAR && est.dia !== hoje()) {
  est.dia = hoje(); sujo = true;
  avisar(`🤖 *Robô de descontos ligado* (${hoje().split("-").reverse().join("/")})\n\n${textoRegras(est)}\n\nMande *ajuda* pra ver os comandos.`);
}

const visto = new Set();
let portal = null, filial = {}, filiaisEm = 0, falhas = 0, avisoFalhaEm = 0, tentativas = {};
const cont = { aprov: 0, reprov: 0, manual: 0 };

async function ciclo() {
  if (!portal) portal = await abrirPortal();
  if (Date.now() - filiaisEm > 3600e3) {
    const fs = await portal.filiais();
    filial = Object.fromEntries(fs.filter((f) => f.codigoProtheus).map((f) => [String(f.codigoProtheus).trim(), f.regional]));
    filiaisEm = Date.now();
  }
  const itens = await portal.pendentes();
  for (const it of itens) {
    if (it?.decision?.canDecide === false) continue;
    if (it?.decision?.finalStatus && it.decision.finalStatus !== "PENDENTE") continue;
    const reg = regionalDe(filial[String(it.branchCode).trim()] ?? it.regional);
    const d = decidir(it, reg, est);
    if (d.acao === "MANUAL") {
      if (!est.avisados[it.id] && !visto.has(it.id)) { visto.add(it.id); if (!SIMULAR) { est.avisados[it.id] = Date.now(); sujo = true; } cont.manual++; avisar(textoAviso(it, reg, d, est)); }
      continue;
    }
    if ((tentativas[it.id] || 0) >= 2) continue;
    if (SIMULAR) { if (!visto.has(it.id)) { visto.add(it.id); console.log(`🧪 faria: ${d.acao} (${reg})`); avisar(textoAviso(it, reg, d, est, "ok")); } continue; } // já falhou 2x e já avisou: fica pro Ed
    const decisao = d.acao === "APROVAR" ? "APROVADO" : "REPROVADO_MANUAL";
    const nota = `${d.acao === "APROVAR" ? "Aprovado" : "Reprovado"} automaticamente pela regra do Ednilson (${reg}): ${d.motivo}.`;
    try {
      await portal.decidir(it, decisao, nota);
      d.acao === "APROVAR" ? cont.aprov++ : cont.reprov++;
      est.avisados[it.id] = Date.now();
      est.historico.push({ t: Date.now(), tipo: decisao, pedido: it.orderNumber, reg, desc: it.discountPercentage, margem: it.evaluation?.regionalMargin, min: est.regras[reg]?.min });
      sujo = true;
      console.log(`✅ ${d.acao === "APROVAR" ? "aprovado" : "reprovado"} 1 pedido (${reg})`);
      avisar(textoAviso(it, reg, d, est, "ok"));
    } catch (e) {
      tentativas[it.id] = (tentativas[it.id] || 0) + 1;
      console.log(`⚠️ decisão não registrada (tentativa ${tentativas[it.id]}): ${String(e.message).slice(0, 100)}`);
      if (tentativas[it.id] >= 2) avisar(textoAviso(it, reg, { ...d, motivo: `${d.motivo}. Portal recusou: ${String(e.message).slice(0, 120)}` }, est, "erro"));
    }
  }
}

while (true) {
  if (wa.desconectado()) { avisar("❌ O WhatsApp do robô foi desconectado. Precisa conectar de novo."); break; }
  try {
    await ciclo();
    if (falhas >= 3) avisar("✅ *Robô de descontos voltou* a ler o portal.");
    falhas = 0;
  } catch (e) {
    falhas++;
    const msg = String(e.message || e);
    console.log(`⚠️ ciclo falhou (${falhas}): ${msg.slice(0, 120)}`);
    if (/LOGIN/.test(msg) || falhas >= 3) {
      if (Date.now() - avisoFalhaEm > 3600e3) {
        avisoFalhaEm = Date.now();
        avisar(/LOGIN/.test(msg)
          ? "❌ *Robô de descontos*: o portal recusou o login do Ed (senha trocada?). Os pedidos ficam no manual até atualizar o secret ED_SENHA."
          : `⚠️ *Robô de descontos* não está conseguindo ler o portal (${msg.slice(0, 80)}). Os pedidos ficam no manual; sigo tentando.`);
      }
    }
    await portal?.fechar(); portal = null;
    if (/LOGIN/.test(msg)) await dorme(5 * 60e3);
  }
  if (sujo && !SIMULAR) { sujo = false; await salvar(est).catch((e) => console.log("⚠️ estado:", e.message)); }
  if (Date.now() - INICIO > DURACAO || hora() >= 23) break;
  await new Promise((r) => { acordar = r; setTimeout(r, falhas ? 30000 : CICLO); });
  acordar = null;
}

// fim do dia: resumo
if (!SIMULAR && hora() >= 23 && est.resumo !== hoje()) {
  const dia = est.historico.filter((h) => h.t > Date.now() - 18 * 3600e3);
  const a = dia.filter((h) => h.tipo === "APROVADO").length, r = dia.filter((h) => h.tipo === "REPROVADO_MANUAL").length;
  est.resumo = hoje();
  avisar(`🌙 *Resumo do robô de descontos — hoje*\n✅ Aprovados: *${a}*\n🚫 Reprovados: *${r}*\n\n${textoRegras(est)}`);
  await salvar(est).catch(() => {});
}
console.log(`▶ Fim do turno: ${cont.aprov} aprovados, ${cont.reprov} reprovados, ${cont.manual} pro Ed`);
await portal?.fechar();
await wa.fechar();
process.exit(0);
