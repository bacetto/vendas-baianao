// Robô de descontos do Ed — roda o dia todo no GitHub Actions (07h–23h de Salvador).
// Fluxo (igual ao de hoje, só que automático):
//   1. o regional manda o pedido no grupo "LIBERAÇÃO DESCONTO" (Filial / Pedido / ...);
//   2. o robô acha o pedido nos "Orçamentos para aprovação" do portal (login do Ed);
//   3. aplica a regra de margem do regional que vocês mandaram no WhatsApp;
//   4. aprova/reprova no portal, responde no grupo (citando a mensagem) e manda o detalhe na conversa "você mesmo".
// Pedido que NÃO foi pedido no grupo: o robô não toca. Registro público: só contagens.
import { abrirPortal } from "./portal.js";
import { carregar, salvar } from "./estado.js";
import { zap } from "./zap.js";
import { comando, decidir, regionalDe, textoAviso, textoRegras, lerPedidos, bate } from "./regras.js";

const CICLO = 15000;
const SIMULAR = process.env.SIMULAR === "1"; // teste: lê e avisa o que faria, sem mexer no portal nem no grupo
const GRUPO = process.env.GRUPO_LIBERACAO || "LIBERAÇÃO DESCONTO";
const GRUPO_AVISOS = process.env.GRUPO_AVISOS || "ROBÔ DE DESCONTOS"; // grupo Gabriel + Ednilson: detalhes e comandos
const ESPERA_PORTAL = 15 * 60e3;  // pedido do grupo que não aparece nos pendentes do Ed em 15 min: avisa
const VALIDADE = 4 * 3600e3;      // pedido do grupo vale 4h
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
est.solicitados ||= {};
console.log(`▶ Regras carregadas (${Object.keys(est.regras).length} regionais com regra${est.pausado ? ", pausado" : ""})`);
let sujo = false, acordar = null, grupoId = null, avisosId = null, avisosEm = 0;
let wa = null; const antes = [];
const avisar = (t0) => { const t = SIMULAR ? `🧪 *SIMULAÇÃO* (nada foi feito no portal nem no grupo)\n${t0}` : t0; (avisosId ? [avisosId] : DEST).forEach((d) => (wa ? wa.enviar(d, t) : antes.push([d, t]))); };
const noGrupo = (texto, citar) => { if (!SIMULAR && grupoId) wa.enviar(grupoId, texto, citar); };

function mensagem(txt, info) {
  // pedido novo no grupo LIBERAÇÃO DESCONTO
  if (grupoId && info.jid === grupoId) {
    const ps = lerPedidos(txt);
    for (const p of ps) {
      est.solicitados[p.pedido] = { ...p, t: Date.now(), msg: { key: info.msg.key, message: { conversation: txt.slice(0, 600) } } };
      console.log("▶ Pedido recebido no grupo");
    }
    if (ps.length) { sujo = true; acordar?.(); }
    return;
  }
  // comandos: no grupo de avisos (Gabriel + Ed), na conversa "você mesmo", ou vindos do Ed
  const doEd = ED && !info.fromMe && info.de.includes(ED);
  const doGrupoAvisos = avisosId && info.jid === avisosId;
  if (!info.conversaComigo && !doEd && !doGrupoAvisos) return;
  const r = comando(txt, est);
  if (!r) return;
  console.log("▶ Comando recebido");
  if (r.mudou) { est.historico.push({ t: Date.now(), tipo: "comando", txt: txt.trim().slice(0, 40), quem: doEd ? "ed" : "eu" }); sujo = true; acordar?.(); }
  avisar(r.resposta);
}
const cedo = [];
wa = await zap({ onTexto: (txt, info) => (grupoId === null ? cedo.push([txt, info]) : mensagem(txt, info)) });
grupoId = await wa.grupo(GRUPO).catch(() => null);
async function acharAvisos() {
  avisosEm = Date.now();
  const id = await wa.grupo(GRUPO_AVISOS).catch(() => null);
  if (id && id !== avisosId) { avisosId = id; console.log("✅ Grupo de avisos encontrado"); return true; }
  return false;
}
await acharAvisos();
if (!avisosId) avisar(`⚠️ *Robô de descontos*: ainda não achei o grupo "${GRUPO_AVISOS}". Enquanto isso, os avisos vêm aqui.`);
if (!grupoId) { grupoId = undefined; avisar(`⚠️ *Robô de descontos*: não achei o grupo "${GRUPO}" neste WhatsApp. Sem ele, não pego os pedidos.`); }
else console.log("✅ Grupo de liberação encontrado");
for (const [t, i] of cedo.splice(0)) mensagem(t, i);
for (const [d, t] of antes.splice(0)) wa.enviar(d, t);

if (!SIMULAR && est.dia !== hoje()) {
  est.dia = hoje(); sujo = true;
  avisar(`🤖 *Robô de descontos ligado* (${hoje().split("-").reverse().join("/")})\nPego os pedidos do grupo *${GRUPO}*.\n\n${textoRegras(est)}\n\nMande *ajuda* pra ver os comandos.`);
}

const visto = new Set();
let portal = null, filial = {}, filiaisEm = 0, falhas = 0, avisoFalhaEm = 0;
const tentativas = {}, cont = { aprov: 0, reprov: 0, manual: 0 };

async function ciclo() {
  // grupo de avisos criado depois: procura de novo a cada 10 min
  if (!avisosId && Date.now() - avisosEm > 10 * 60e3 && (await acharAvisos())) avisar(`✅ Grupo de avisos conectado.\n\n${textoRegras(est)}\n\nMande *ajuda* pra ver os comandos.`);
  // limpa pedidos do grupo vencidos
  for (const [k, s] of Object.entries(est.solicitados)) if (Date.now() - s.t > VALIDADE) { delete est.solicitados[k]; sujo = true; }
  const sols = Object.values(est.solicitados);
  if (!sols.length) return; // nada pedido no grupo: nem consulta o portal

  if (!portal) portal = await abrirPortal();
  if (Date.now() - filiaisEm > 3600e3) {
    const fs = await portal.filiais();
    filial = Object.fromEntries(fs.filter((f) => f.codigoProtheus).map((f) => [String(f.codigoProtheus).trim(), f.regional]));
    filiaisEm = Date.now();
  }
  const itens = await portal.pendentes();
  for (const sol of sols) {
    const it = itens.find((i) => bate(sol, i));
    if (!it) {
      if (!sol.semPortal && Date.now() - sol.t > ESPERA_PORTAL) {
        sol.semPortal = true; sujo = true;
        avisar(`🔎 Pedido *${sol.pedido}* (filial ${sol.filial ?? "?"}) foi pedido no grupo, mas não está nos pendentes do Ed no portal há 15 min (já decidido, número errado ou não precisou de aprovação). Não fiz nada.`);
      }
      continue;
    }
    if (it?.decision?.canDecide === false || (it?.decision?.finalStatus && it.decision.finalStatus !== "PENDENTE")) continue;
    const reg = regionalDe(filial[String(it.branchCode).trim()] ?? it.regional);
    const d = decidir(it, reg, est);

    if (d.acao === "MANUAL") {
      if (!sol.avisado && !visto.has(it.id)) { visto.add(it.id); if (!SIMULAR) { sol.avisado = true; sujo = true; } cont.manual++; avisar(textoAviso(it, reg, d, est)); }
      continue;
    }
    if (SIMULAR) { if (!visto.has(it.id)) { visto.add(it.id); console.log(`🧪 faria: ${d.acao} (${reg})`); avisar(textoAviso(it, reg, d, est, "ok")); } continue; }
    if ((tentativas[it.id] || 0) >= 2) continue; // já falhou 2x e já avisou: fica pro Ed

    const decisao = d.acao === "APROVAR" ? "APROVADO" : "REPROVADO_MANUAL";
    const nota = `${d.acao === "APROVAR" ? "Aprovado" : "Reprovado"} automaticamente pela regra do Ednilson (${reg}): ${d.motivo}.`;
    try {
      await portal.decidir(it, decisao, nota);
      d.acao === "APROVAR" ? cont.aprov++ : cont.reprov++;
      est.historico.push({ t: Date.now(), tipo: decisao, pedido: it.orderNumber, reg, desc: it.discountPercentage, margem: it.evaluation?.regionalMargin, min: est.regras[reg]?.min });
      delete est.solicitados[sol.pedido];
      sujo = true;
      console.log(`✅ ${d.acao === "APROVAR" ? "aprovado" : "reprovado"} 1 pedido (${reg})`);
      noGrupo(d.acao === "APROVAR" ? "aprovado ✅" : `não aprovado ❌ — ${/desconto do pedido/.test(d.motivo) ? "desconto acima do máximo permitido" : "margem do regional abaixo do limite"}`, sol.msg);
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
    if ((/LOGIN/.test(msg) || falhas >= 3) && Date.now() - avisoFalhaEm > 3600e3) {
      avisoFalhaEm = Date.now();
      avisar(/LOGIN/.test(msg)
        ? "❌ *Robô de descontos*: o portal recusou o login do Ed (senha trocada?). Os pedidos ficam no manual até atualizar o secret ED_SENHA."
        : `⚠️ *Robô de descontos* não está conseguindo ler o portal (${msg.slice(0, 80)}). Os pedidos ficam no manual; sigo tentando.`);
    }
    await portal?.fechar(); portal = null;
    if (/LOGIN/.test(msg)) await dorme(5 * 60e3);
  }
  if (sujo && !SIMULAR) { sujo = false; await salvar(est).catch((e) => console.log("⚠️ estado:", e.message)); }
  if (Date.now() - INICIO > DURACAO || hora() >= 23) break;
  await new Promise((r) => { acordar = r; setTimeout(r, falhas ? 30000 : CICLO); });
  acordar = null;
}

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
