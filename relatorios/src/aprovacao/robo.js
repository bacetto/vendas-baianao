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
import { comando, decidir, regionalDe, textoAviso, textoRegras, lerPedidos, bate, soEdnilson, REGIONAIS } from "./regras.js";
import { textoBoletim, BOLETIM_HORAS, textoJanela, textoDia, JANELA_HORAS, FOTO_HORAS, textoLeads, LEADS_HORAS } from "./boletim.js";
import { detalheLojas, leadsLojas } from "./painel-snap.js";

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
// 27/11: contagem do dia pro resumo — pedidos "só do Ed" (só Ed aprova ou desconto > 20%) que passaram no Universo e os aprovados pelo robô, por regional
function diaPedidos() {
  if (est.diaPedidos?.dia === hoje()) return est.diaPedidos;
  const ini = Date.parse(`${hoje()}T03:00:00Z`); // 00h de Salvador
  est.diaPedidos = { dia: hoje(), ids: {}, aprov: {} };
  // começo da contagem no meio do dia: aproveita o que o robô já tinha registrado hoje
  for (const [id, t] of Object.entries(est.avisados || {})) if (t >= ini) est.diaPedidos.ids[id] = "?";
  for (const h of est.historico || []) if (h.tipo === "APROVADO" && h.t >= ini) est.diaPedidos.aprov[`p${h.pedido}`] = h.reg || "?";
  return est.diaPedidos;
}
// Ajustes de regra pedidos fora do grupo (aplicados uma vez só; o id fica salvo no estado)
est.ajustes ||= [];
const AJUSTES = [
  // 25/11: Gabriel pediu desconto máximo de 27% quando o pedido tiver serviço vendido junto (sem serviço continua o D atual)
  { id: "2026-11-25-dserv27", aplicar: (e) => { let n = 0; for (const r of Object.keys(e.regras)) if (typeof e.regras[r]?.max === "number") { e.regras[r].maxServ = 27; n++; } return n; } },
  // 24/11: Gabriel pediu desconto máximo de 20% -> 25% (sem mexer pelo grupo)
  { id: "2026-11-24-d20-d25", aplicar: (e) => { let n = 0; for (const r of Object.keys(e.regras)) if (e.regras[r]?.max === 20) { e.regras[r].max = 25; e.regras[r].em = new Date().toISOString(); n++; } return n; } },
];
let ajustouAgora = false;
for (const a of AJUSTES) if (!est.ajustes.includes(a.id)) { const n = a.aplicar(est); est.ajustes.push(a.id); ajustouAgora = true; console.log(`✅ Ajuste ${a.id}: ${n} regional(is)`); }
console.log(`▶ Regras carregadas (${Object.keys(est.regras).length} regionais com regra${est.pausado ? ", pausado" : ""})`);
let sujo = ajustouAgora, acordar = null, grupoId = null, avisosId = null, avisosEm = 0;
let wa = null; const antes = [];
const avisar = (t0, ok) => { const t = SIMULAR ? `🧪 *SIMULAÇÃO* (nada foi feito no portal)\n${t0}` : t0; (avisosId ? [avisosId] : DEST).forEach((d, i) => (wa ? wa.enviar(d, t, undefined, i === 0 ? ok : undefined) : antes.push([d, t]))); };

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
// números do DIA por regional (margem e serviços): atualiza a cada 3 min em paralelo (não segura a decisão)
const serv = { regs: {}, em: 0, carregando: false, tentou: 0 };
function atualizarServicos() {
  if (serv.carregando || !portal || Date.now() - serv.tentou < 3 * 60e3) return; // números do dia: relê a cada 3 min
  serv.carregando = true; serv.tentou = Date.now();
  portal.numerosDia().then((r) => { if (Object.keys(r).length) { serv.regs = r; serv.em = Date.now(); console.log("✅ Números do dia dos regionais atualizados"); } })
    .catch((e) => { serv.tentou = Date.now() - 2 * 60e3; console.log("⚠️ números do dia não lidos:", String(e.message).slice(0, 80)); })
    .finally(() => { serv.carregando = false; });
}
// só vale número do DIA de hoje e lido há menos de 15 min
const servDe = (reg) => { const b = serv.regs[reg]; return b && Date.now() - serv.em < 15 * 60e3 && b.dia === new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) ? b : null; };

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
    if (jan.enviando) return;
    jan.enviando = true;
    // leitura sem o detalhe (vendido/devolução/pedidos): completa com a publicação do painel daquele horário
    const completa = async (hh) => {
      const f = est.fotos[hh]; if (!f || Object.values(f).every((x) => typeof x === "object")) return;
      const alvo = est.fotos.t?.[hh] || Date.parse(`${hoje()}T${String(hh).padStart(2, "0")}:01:00-03:00`);
      const s = await detalheLojas(alvo, hoje());
      for (const n of Object.keys(f)) if (typeof f[n] === "number") f[n] = { v: f[n], ...(s.lojas[n] || { b: 0, d: 0, p: 0 }) }; // loja fora do painel = nenhuma venda até ali
      sujo = true;
    };
    Promise.allSettled([completa(h)]).then((r) => {
      for (const x of r) if (x.status === "rejected") console.log("⚠️ detalhe das lojas não completado:", String(x.reason?.message || x.reason).slice(0, 80));
      const info = {};
      for (const n of Object.keys(est.fotos[h])) info[n] = { reg: est.fotos.reg?.[n], nome: nomeLoja[n] || `Loja ${n}` };
      wa.enviar(ED || "eu", textoDia(est.fotos[h], info, h)); // 24/11: venda do DIA (não das últimas 2h), de 2 em 2h
      est.janela = chave; sujo = true;
      console.log(`✅ Lojas abaixo de 5 mil (${h}h) enviado`);
    }).finally(() => { jan.enviando = false; });
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
    est.fotos[h] = foto; (est.fotos.t ||= {})[h] = Date.now(); sujo = true;
    console.log(`✅ Leitura das lojas (${h}h)`);
  }).catch((e) => console.log("⚠️ leitura das lojas falhou:", String(e.message).slice(0, 80)))
    .finally(() => { jan.carregando = false; });
}

// Boletim pro Ed de 2 em 2 horas (parcial do DIA: margem / serviços por regional). Roda em paralelo, sem segurar as aprovações;
// tenta de novo a cada 2 min até :50 da hora; "est.boletim" evita mandar 2x (inclusive na troca de turno).
const bol = { carregando: false, tentou: 0, avisou: null };
// Lojas com menos de 3 contatos com leads NO DIA (pro Ed, 11h/14h/17h/20h). Contatos vêm do painel de vendas
// (Painel Vendas Leads do Universo, lido a cada ~1 min): usa o acumulado do dia publicado na hora cheia.
// Não usa o portal do Ed. "est.leads" evita mandar 2x (inclusive na troca de turno). 1ª vez: cópia pro Gabriel conferir.
const ld = { carregando: false, tentou: 0, avisou: null };
function leadsJanela() {
  const h = hora(), min = bahia().getUTCMinutes(), chave = `${hoje()}-${h}`;
  if (SIMULAR || !LEADS_HORAS.includes(h) || est.leads === chave || ld.carregando || Date.now() - ld.tentou < 60e3) return;
  if (min >= 50) { if (ld.avisou !== chave) { ld.avisou = chave; wa.enviar("eu", `⚠️ *Lojas com menos de 3 contatos de leads (${h}h)* não saiu pro Ed: o painel não respondeu.`); } return; }
  ld.carregando = true; ld.tentou = Date.now();
  const alvo = (hh) => Date.parse(`${hoje()}T${String(hh).padStart(2, "0")}:00:30-03:00`);
  leadsLojas(alvo(h), hoje()).then((g) => {
    const t = textoLeads(g.contatos, g.abertas, h);
    wa.enviar(ED || "eu", t);
    if (!est.leadsTeste) { wa.enviar("eu", `🧪 *Cópia pra você conferir — o Ed recebeu agora:*\n\n${t}`); est.leadsTeste = Date.now(); }
    est.leads = chave; sujo = true;
    console.log(`✅ Lojas com menos de 3 contatos de leads (${h}h) enviado`);
  }).catch((e) => console.log("⚠️ leads das lojas falhou:", String(e.message).slice(0, 80)))
    .finally(() => { ld.carregando = false; });
}

function boletim() {
  const h = hora(), min = bahia().getUTCMinutes(), chave = `${hoje()}-${h}`;
  // 27/11 ~10:22: Gabriel pediu a parcial de AGORA com o GERAL real, só pra ele (uma vez só; o Ed não recebe)
  if (!SIMULAR && portal && hoje() === "2026-11-27" && !est.ajustes.includes("parcial-agora-2026-11-27") && !bol.carregando && Date.now() - bol.tentou > 60e3) {
    bol.carregando = true; bol.tentou = Date.now();
    portal.resumoDia().then((r) => {
      const t = textoBoletim(r, h);
      if (!t) throw new Error("números dos regionais incompletos");
      const hm = bahia().toISOString().slice(11, 16).replace(":", "h");
      wa.enviar("eu", t.replace(/Parcial do dia — \d+h/, `Parcial do dia — ${hm}`));
      est.ajustes.push("parcial-agora-2026-11-27"); sujo = true;
      console.log("✅ Parcial de agora enviada pro Gabriel");
    }).catch((e) => console.log("⚠️ parcial de agora não saiu:", String(e.message).slice(0, 80))).finally(() => { bol.carregando = false; });
    return;
  }
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
  leadsJanela();
  // 24/11 ~17:40: Gabriel pediu pra mandar ao Ed agora a venda do DIA até o momento (uma vez só)
  if (!SIMULAR && !est.ajustes.includes("agora-2026-11-24-dia") && hoje() === "2026-11-24" && est.fotos?.[17] && Object.keys(nomeLoja).length && !jan.agora) {
    jan.agora = true;
    detalheLojas(Date.now(), hoje()).then((sn) => {
      const foto = {}, info = {};
      for (const n of Object.keys(est.fotos[17])) { foto[n] = { v: 0, b: sn.lojas[n]?.b || 0 }; info[n] = { reg: est.fotos.reg?.[n], nome: nomeLoja[n] || `Loja ${n}` }; }
      const hm = new Date(sn.em - 3 * 3600e3).toISOString().slice(11, 16);
      wa.enviar(ED || "eu", textoDia(foto, info, hm));
      est.ajustes.push("agora-2026-11-24-dia"); sujo = true;
      console.log("✅ Venda do dia até agora enviada pro Ed");
    }).catch((e) => { jan.agora = false; console.log("⚠️ venda do dia agora falhou:", String(e.message).slice(0, 80)); });
  }
  // 24/11: Gabriel pediu pra reenviar ao Ed a lista das 15h–17h no formato novo (uma vez só)
  if (!SIMULAR && !est.ajustes.includes("reenvio-2026-11-24-17") && est.fotos?.dia === "2026-11-24" && est.fotos[15] && est.fotos[17] && Object.keys(nomeLoja).length) {
    const info = {};
    for (const n of Object.keys(est.fotos[17])) info[n] = { reg: est.fotos.reg?.[n], nome: nomeLoja[n] || `Loja ${n}` };
    wa.enviar(ED || "eu", textoJanela(est.fotos[15], est.fotos[17], info, 17));
    est.ajustes.push("reenvio-2026-11-24-17"); sujo = true;
    console.log("✅ Reenvio das 15h–17h pro Ed");
  }
  // lê DIRETO os pendentes do Ed no portal (não espera o grupo): decide assim que o pedido cai lá
  const itens = await portal.pendentes();
  for (const it of itens) {
    if (!it?.id) continue;
    if (it?.decision?.canDecide === false || (it?.decision?.finalStatus && it.decision.finalStatus !== "PENDENTE")) continue;
    if (!soEdnilson(it)) continue; // outra pessoa também pode aprovar: fora da automação (nem aprova, nem avisa)
    primeiraVez[it.id] ||= Date.now();
    const reg = regionalDe(filial[String(it.branchCode).trim()] ?? it.regional);
    { const dp = diaPedidos(); const rg = reg || "?"; if (dp.ids[it.id] !== rg && (dp.ids[it.id] === undefined || dp.ids[it.id] === "?")) { dp.ids[it.id] = rg; sujo = true; } }
    let d = decidir(it, reg, est, servDe(reg));
    if (d.acao === "ESPERAR") {
      if (Date.now() - primeiraVez[it.id] < 10 * 60e3) continue; // números do dia chegando
      d = { acao: "MANUAL", motivo: "não consegui ler (ou conferir) os números do dia do regional no portal" };
    }
    if (d.acao !== "APROVAR") {
      if (!est.avisados[it.id] && !visto.has(it.id)) { visto.add(it.id); cont.manual++; const id = it.id; avisar(textoAviso(it, reg, d, est, undefined, servDe(reg)), () => { if (!SIMULAR) { est.avisados[id] = Date.now(); sujo = true; } }); }
      continue; // o robô SÓ aprova; nunca reprova
    }
    if (SIMULAR) { if (!visto.has(it.id)) { visto.add(it.id); console.log(`🧪 faria: APROVAR (${reg})`); avisar(textoAviso(it, reg, d, est, "ok", servDe(reg))); } continue; }
    if ((tentativas[it.id] || 0) >= 2) continue; // já falhou 2x e já avisou: fica pro Ed
    const nota = process.env.NOTA_APROVACAO || "vendaa"; // descrição no portal quando o ROBÔ aprova ("vendaa" com 2 "a" = foi o robô)
    // 27/11: foto dos números do regional ANTES de somar o pedido — o aviso tem que mostrar os mesmos números da decisão
    const baseDecisao = servDe(reg) ? { ...servDe(reg) } : null;
    try {
      await portal.decidir(it, "APROVADO", nota);
      cont.aprov++;
      // aprovado: já soma o pedido no regional até a próxima leitura do portal (o próximo pedido é avaliado em cima disso)
      const b = serv.regs[reg];
      if (b) {
        const ps = it.products || [];
        b.venda += Number(it.finalValue) || 0;
        b.pacote += (it.services || []).reduce((a, x) => a + (Number(x.finalValue) || 0), 0);
        // margem: não soma o pedido (custo do pedido é outra base); fica a margem real do Universo até a próxima leitura
      }
      est.avisados[it.id] = Date.now();
      est.historico.push({ t: Date.now(), tipo: "APROVADO", pedido: it.orderNumber, reg, desc: it.discountPercentage });
      diaPedidos().aprov[`p${it.orderNumber}`] = reg || "?";
      sujo = true;
      console.log(`✅ aprovado 1 pedido (${reg})`);
      if (!d.silencioso) avisar(textoAviso(it, reg, d, est, "ok", baseDecisao)); // liberado direto (até 25% hoje): aprova sem aviso no grupo
    } catch (e) {
      tentativas[it.id] = (tentativas[it.id] || 0) + 1;
      console.log(`⚠️ aprovação não registrada (tentativa ${tentativas[it.id]}): ${String(e.message).slice(0, 100)}`);
      if (tentativas[it.id] >= 2 && d.silencioso) wa.enviar("eu", `⚠️ Pedido #${it.orderNumber} (até 25%, liberado direto hoje): o portal recusou a aprovação 2x — fica pro Ed.`);
      else if (tentativas[it.id] >= 2) avisar(textoAviso(it, reg, { ...d, motivo: `${d.motivo}. Portal recusou: ${String(e.message).slice(0, 120)}` }, est, "erro"));
    }
  }
}

// atualização automática: se subir código novo no GitHub, este turno encerra e o próximo já sobe com o código novo
const MEU_SHA = process.env.GITHUB_SHA || "";
let shaEm = 0;
async function temCodigoNovo() {
  if (!MEU_SHA || !process.env.GITHUB_REPOSITORY || Date.now() - shaEm < 2 * 60e3) return false;
  shaEm = Date.now();
  try {
    const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/commits/main`, { headers: { Accept: "application/vnd.github.sha", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
    const sha = r.ok ? (await r.text()).trim() : "";
    if (!/^[0-9a-f]{40}$/.test(sha) || sha === MEU_SHA) return false;
    // só reinicia se mudou o código do robô (mudança na Central, no painel etc. não derruba o turno)
    const c = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/compare/${MEU_SHA}...${sha}`, { headers: { Accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
    if (!c.ok) return true;
    const fs = ((await c.json()).files || []).map((f) => f.filename);
    return fs.some((f) => f.startsWith("relatorios/") || f === ".github/workflows/robo-descontos.yml");
  } catch { return false; }
}

while (true) {
  if (await temCodigoNovo()) { console.log("▶ Código novo no GitHub: encerrando este turno pra subir a versão nova"); break; }
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
  const dp = diaPedidos();
  const ap = Object.values(dp.aprov), a = ap.length, total = Object.keys(dp.ids).length;
  const porReg = REGIONAIS.map((r) => `${r} - ${ap.filter((x) => x === r).length} APROVADOS`);
  const semReg = ap.filter((x) => !REGIONAIS.includes(x)).length;
  if (semReg) porReg.push(`Sem regional - ${semReg} APROVADOS`);
  est.resumo = hoje();
  avisar(`🌙 *Resumo do robô de descontos — hoje*\n✅ Aprovados: *${a}*\n${porReg.join("\n")}\n\n📥 Pedidos só do Ed no Universo hoje: *${total}*\n_(só o Ed libera ou desconto acima de 20%)_\n\n${textoRegras(est)}`);
  await salvar(est).catch(() => {});
}
if (sujo && !SIMULAR) await salvar(est).catch(() => {}); // garante que o próximo turno saiba o que já foi enviado
console.log(`▶ Fim do turno: ${cont.aprov} aprovados, ${cont.reprov} reprovados, ${cont.manual} pro Ed`);
await portal?.fechar();
await wa.fechar();
process.exit(0);
