// Robô de descontos do Ed — roda o dia todo no GitHub Actions (07h–23h de Salvador).
// Fluxo (igual ao de hoje, só que automático):
//   1. lê direto os "Orçamentos para aprovação" pendentes do Ed no portal, a cada ~15 s (não espera o grupo);
//   3. aplica a regra de margem do regional que vocês mandaram no WhatsApp;
//   4. aprova/reprova no portal e manda o detalhe no grupo DETALHAMENTO APROVAÇÕES BAIANAO (Gabriel + Ednilson).
//   O robô NUNCA escreve no grupo LIBERAÇÃO DESCONTO: só lê.
// O que não cumpre as 3 regras fica pro Ed (o regional pede no LIBERAÇÃO DESCONTO como antes). Registro público: só contagens.
import { abrirPortal } from "./portal.js";
import { carregar, salvar } from "./estado.js";
import { zap } from "./zap.js";
import { comando, decidir, regionalDe, textoAviso, textoRegras, lerPedidos, bate, soEdnilson } from "./regras.js";
import { textoBoletim, BOLETIM_HORAS, textoJanela, JANELA_HORAS, FOTO_HORAS } from "./boletim.js";

const CICLO = 15000;
const SIMULAR = process.env.SIMULAR === "1"; // teste: lê e avisa o que faria, sem mexer no portal nem no grupo
const GRUPO = process.env.GRUPO_LIBERACAO || "LIBERAÇÃO DESCONTO";
const GRUPO_AVISOS = process.env.GRUPO_AVISOS || "DETALHAMENTO APROVAÇÕES BAIANAO"; // grupo Gabriel + Ednilson: detalhes e comandos
const ESPERA_PORTAL = 3 * 60e3;   // pedido do grupo que não aparece nos pendentes do Ed em 3 min: avisa (com o histórico)
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
const avisar = (t0) => { const t = SIMULAR ? `🧪 *SIMULAÇÃO* (nada foi feito no portal)\n${t0}` : t0; (avisosId ? [avisosId] : DEST).forEach((d) => (wa ? wa.enviar(d, t) : antes.push([d, t]))); };

function mensagem(txt, info) {
  // pedido novo no grupo LIBERAÇÃO DESCONTO
  if (grupoId && info.jid === grupoId) return; // grupo LIBERAÇÃO: o robô não usa mais (lê direto do portal)
  if (false) {
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
  // uma regra por linha (pode mandar as 4 numa mensagem só)
  const linhas = String(txt).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const rs = linhas.map((l) => [l, comando(l, est)]).filter(([, r]) => r);
  if (!rs.length) return;
  console.log(`▶ Comando recebido (${rs.length})`);
  let mudou = false;
  for (const [l, r] of rs) if (r.mudou) { mudou = true; est.historico.push({ t: Date.now(), tipo: "comando", txt: l.slice(0, 40), quem: doEd ? "ed" : "eu" }); }
  if (mudou) { sujo = true; acordar?.(); }
  // várias regras: responde com o quadro completo (fica claro o que ficou valendo)
  avisar(rs.length > 1 && mudou ? textoRegras(est) : rs.map(([, r]) => r.resposta).join("\n"));
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
if (!grupoId) grupoId = undefined; // o grupo LIBERAÇÃO não é mais necessário: o robô lê direto do portal
else console.log("✅ Grupo de liberação encontrado");
for (const [t, i] of cedo.splice(0)) mensagem(t, i);
for (const [d, t] of antes.splice(0)) wa.enviar(d, t);

if (!SIMULAR && est.dia !== hoje()) {
  est.dia = hoje(); sujo = true;
  avisar(`🤖 *Robô de descontos ligado* (${hoje().split("-").reverse().join("/")})\nLeio direto os pendentes do Ed no portal.\n\n${textoRegras(est)}\n\nMande *ajuda* pra ver os comandos.`);
}

const visto = new Set(), primeiraVez = {};
let falhasSenha = 0;
let portal = null, filial = {}, filiaisEm = 0, falhas = 0, avisoFalhaEm = 0;
const tentativas = {}, cont = { aprov: 0, reprov: 0, manual: 0 };
// % de serviços do mês por regional: consulta pesada, atualiza a cada 10 min em paralelo (não segura a decisão)
const serv = { regs: {}, em: 0, carregando: false, tentou: 0 };
function atualizarServicos() {
  if (serv.carregando || !portal || Date.now() - serv.tentou < 10 * 60e3) return;
  serv.carregando = true; serv.tentou = Date.now();
  portal.servicosMes().then((r) => { if (Object.keys(r).length) { serv.regs = r; serv.em = Date.now(); console.log("✅ Serviços do mês atualizados"); } })
    .catch((e) => { serv.tentou = Date.now() - 8 * 60e3; console.log("⚠️ serviços não lidos:", String(e.message).slice(0, 80)); })
    .finally(() => { serv.carregando = false; });
}
const servDe = (reg) => (Date.now() - serv.em < 60 * 60e3 ? serv.regs[reg] : null);

// Lojas abaixo de R$ 5 mil nas últimas 2h (pro Ed, 11h–21h): fotografa a venda do dia de cada loja às 9, 11 ... 21h
// e compara com a foto de 2h antes. Fotos ficam no estado criptografado (sobrevivem à troca de turno).
const jan = { carregando: false, tentou: 0, avisou: null };
let nomeLoja = {};
function janela() {
  const h = hora(), min = bahia().getUTCMinutes();
  if (SIMULAR || !portal || !FOTO_HORAS.includes(h)) return;
  if (est.fotos?.dia !== hoje()) { est.fotos = { dia: hoje() }; }
  const chave = `${hoje()}-${h}`;
  if (est.fotos[h]) {
    if (!JANELA_HORAS.includes(h) || est.janela === chave) return;
    if (!est.fotos[h - 2]) { if (jan.avisou !== chave) { jan.avisou = chave; est.janela = chave; sujo = true; wa.enviar("eu", `⚠️ *Lojas abaixo de R$ 5 mil (${h}h)* não saiu pro Ed: faltou a leitura das ${h - 2}h.`); } return; }
    const info = {};
    for (const n of Object.keys(est.fotos[h])) info[n] = { reg: est.fotos.reg?.[n], nome: nomeLoja[n] || `Loja ${n}` };
    wa.enviar(ED || "eu", textoJanela(est.fotos[h - 2], est.fotos[h], info, h));
    est.janela = chave; sujo = true;
    console.log(`✅ Lojas abaixo de 5 mil (${h}h) enviado`);
    return;
  }
  if (min >= 50) { if (jan.avisou !== chave) { jan.avisou = chave; console.log(`⚠️ leitura das ${h}h não feita`); } return; }
  if (jan.carregando || Date.now() - jan.tentou < 60e3) return;
  jan.carregando = true; jan.tentou = Date.now();
  portal.lojasHoje().then((ls) => {
    if (!ls.length) throw new Error("portal não trouxe as lojas");
    est.fotos.reg ||= {};
    const foto = {};
    for (const l of ls) { foto[l.num] = l.venda; const r = regionalDe(l.regional); if (/^R[1-4]$/.test(r || "")) est.fotos.reg[l.num] = r; }
    est.fotos[h] = foto; sujo = true;
    console.log(`✅ Leitura das lojas (${h}h)`);
  }).catch((e) => console.log("⚠️ leitura das lojas falhou:", String(e.message).slice(0, 80)))
    .finally(() => { jan.carregando = false; });
}

// Boletim pro Ed de 2 em 2 horas (parcial do DIA: margem / serviços por regional). Roda em paralelo, sem segurar as aprovações;
// tenta de novo a cada 2 min até :50 da hora; "est.boletim" evita mandar 2x (inclusive na troca de turno).
const bol = { carregando: false, tentou: 0, avisou: null };
function boletim() {
  const h = hora(), min = bahia().getUTCMinutes(), chave = `${hoje()}-${h}`;
  // 1ª vez: manda uma prévia só pro Gabriel ("você mesmo") pra ele conferir antes do Ed receber
  if (!SIMULAR && portal && !est.boletimTeste && !bol.carregando && Date.now() - bol.tentou > 2 * 60e3 && h >= 10 && h < 23) {
    bol.carregando = true; bol.tentou = Date.now();
    portal.resumoDia().then((r) => {
      const t = textoBoletim(r, h);
      if (!t) throw new Error("números dos regionais incompletos");
      wa.enviar("eu", `🧪 *Prévia do boletim que o Ed vai receber de 2 em 2h (10h às 22h)*\n\n${t}`);
      est.boletimTeste = Date.now(); sujo = true;
      console.log("✅ Prévia do boletim enviada pro Gabriel");
    }).catch((e) => console.log("⚠️ prévia não saiu:", String(e.message).slice(0, 80))).finally(() => { bol.carregando = false; });
    return;
  }
  if (SIMULAR || !portal || !BOLETIM_HORAS.includes(h) || est.boletim === chave) return;
  if (min >= 50) {
    if (bol.avisou !== chave) { bol.avisou = chave; wa.enviar("eu", `⚠️ *Boletim margem/serviços das ${h}h* não saiu pro Ed (portal não respondeu). Sigo tentando na próxima.`); }
    return;
  }
  if (bol.carregando || Date.now() - bol.tentou < 2 * 60e3) return;
  bol.carregando = true; bol.tentou = Date.now();
  portal.resumoDia().then((r) => {
    const t = textoBoletim(r, h);
    if (!t) throw new Error("números dos regionais incompletos");
    wa.enviar(ED || "eu", t);
    est.boletim = chave; sujo = true;
    console.log(`✅ Boletim das ${h}h enviado${ED ? "" : " (sem EDNILSON_NUM: foi pra você)"}`);
  }).catch((e) => console.log("⚠️ boletim não saiu:", String(e.message).slice(0, 80)))
    .finally(() => { bol.carregando = false; });
}

async function ciclo() {
  // grupo de avisos criado depois: procura de novo a cada 10 min
  if (!avisosId && Date.now() - avisosEm > 10 * 60e3 && (await acharAvisos())) avisar(`✅ Grupo de avisos conectado.\n\n${textoRegras(est)}\n\nMande *ajuda* pra ver os comandos.`);

  if (!portal) portal = await abrirPortal();
  if (Date.now() - filiaisEm > 3600e3) {
    const fs = await portal.filiais();
    filial = Object.fromEntries(fs.filter((f) => f.codigoProtheus).map((f) => [String(f.codigoProtheus).trim(), f.regional]));
    for (const f of fs) { const n = Number(String(f.codigoProtheus || "").replace(/\D/g, "").slice(-4)); const nm = String(f.tradeName || f.name || "").replace(/^BAIANAO\s*\/\s*/i, "").trim(); if (n && nm) nomeLoja[n] = nm; }
    filiaisEm = Date.now();
  }
  atualizarServicos();
  boletim();
  janela();
  // lê DIRETO os pendentes do Ed no portal (não espera o grupo): decide assim que o pedido cai lá
  const itens = await portal.pendentes();
  for (const it of itens) {
    if (!it?.id) continue;
    if (it?.decision?.canDecide === false || (it?.decision?.finalStatus && it.decision.finalStatus !== "PENDENTE")) continue;
    if (!soEdnilson(it)) continue; // outra pessoa também pode aprovar: fora da automação (nem aprova, nem avisa)
    primeiraVez[it.id] ||= Date.now();
    const reg = regionalDe(filial[String(it.branchCode).trim()] ?? it.regional);
    let d = decidir(it, reg, est, servDe(reg));
    if (d.acao === "ESPERAR") {
      if (Date.now() - primeiraVez[it.id] < 10 * 60e3) continue; // números do mês chegando
      d = { acao: "MANUAL", motivo: "não consegui ler os números do mês do regional no portal" };
    }
    if (d.acao !== "APROVAR") {
      if (!est.avisados[it.id] && !visto.has(it.id)) { visto.add(it.id); if (!SIMULAR) { est.avisados[it.id] = Date.now(); sujo = true; } cont.manual++; avisar(textoAviso(it, reg, d, est, undefined, servDe(reg))); }
      continue; // o robô SÓ aprova; nunca reprova
    }
    if (SIMULAR) { if (!visto.has(it.id)) { visto.add(it.id); console.log(`🧪 faria: APROVAR (${reg})`); avisar(textoAviso(it, reg, d, est, "ok", servDe(reg))); } continue; }
    if ((tentativas[it.id] || 0) >= 2) continue; // já falhou 2x e já avisou: fica pro Ed
    const nota = process.env.NOTA_APROVACAO || "Venda"; // descrição que vai no portal ao aprovar (igual o Ed usa)
    try {
      await portal.decidir(it, "APROVADO", nota);
      cont.aprov++;
      // aprovado: já soma o pedido no regional até a próxima leitura do portal (o próximo pedido é avaliado em cima disso)
      const b = serv.regs[reg];
      if (b) {
        const ps = it.products || [];
        b.venda += Number(it.finalValue) || 0;
        b.pacote += (it.services || []).reduce((a, x) => a + (Number(x.finalValue) || 0), 0);
        if (typeof b.lucro === "number") b.lucro += ps.reduce((a, x) => a + (Number(x.profit) || 0), 0);
      }
      est.avisados[it.id] = Date.now();
      est.historico.push({ t: Date.now(), tipo: "APROVADO", pedido: it.orderNumber, reg, desc: it.discountPercentage });
      sujo = true;
      console.log(`✅ aprovado 1 pedido (${reg})`);
      avisar(textoAviso(it, reg, d, est, "ok", servDe(reg)));
    } catch (e) {
      tentativas[it.id] = (tentativas[it.id] || 0) + 1;
      console.log(`⚠️ aprovação não registrada (tentativa ${tentativas[it.id]}): ${String(e.message).slice(0, 100)}`);
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
    const senha = /^SENHA/.test(msg);
    falhasSenha = senha ? falhasSenha + 1 : 0;
    // senha: só alarma se o portal recusar 2x seguidas; resto (portal instável): só depois de 3 falhas seguidas
    if ((falhasSenha >= 2 || falhas >= 3) && Date.now() - avisoFalhaEm > 3600e3) {
      avisoFalhaEm = Date.now();
      avisar(falhasSenha >= 2
        ? "❌ *Robô de descontos*: o portal recusou o login do Ed 2 vezes seguidas (senha trocada?). Os pedidos ficam pro Ed até atualizar a senha no GitHub."
        : `⚠️ *Robô de descontos* não está conseguindo ler o portal (${msg.replace(/^\w+: /, "").slice(0, 80)}). Os pedidos ficam pro Ed; sigo tentando.`);
    }
    await portal?.fechar(); portal = null;
    if (senha) await dorme(3 * 60e3);
  }
  if (sujo && !SIMULAR) { sujo = false; await salvar(est).catch((e) => console.log("⚠️ estado:", e.message)); }
  if (Date.now() - INICIO > DURACAO || hora() >= 23) break;
  await new Promise((r) => { acordar = r; setTimeout(r, falhas ? 30000 : CICLO); });
  acordar = null;
}

if (!SIMULAR && hora() >= 23 && est.resumo !== hoje()) {
  const dia = est.historico.filter((h) => h.t > Date.now() - 18 * 3600e3);
  const a = dia.filter((h) => h.tipo === "APROVADO").length;
  est.resumo = hoje();
  avisar(`🌙 *Resumo do robô de descontos — hoje*\n✅ Aprovados: *${a}*\n\n${textoRegras(est)}`);
  await salvar(est).catch(() => {});
}
if (sujo && !SIMULAR) await salvar(est).catch(() => {}); // garante que o próximo turno saiba o que já foi enviado
console.log(`▶ Fim do turno: ${cont.aprov} aprovados, ${cont.reprov} reprovados, ${cont.manual} pro Ed`);
await portal?.fechar();
await wa.fechar();
process.exit(0);
