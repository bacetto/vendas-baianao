// Manda os prints da pasta ./saida pro destino (grupo ou número)
// MODO: meta (8h) | parcial (10..20h) | final (22:20) | mes (7h, acumulado até ontem)
import fs from "node:fs";
import { conectar, acharDestino } from "./whats.js";
import { dadosRanking, dadosRankingLeads, textoMes, textoHora } from "./ranking.js";
import { desenharCard } from "./card.js";

const MODO = process.env.MODO || (process.env.PERIODO === "mes" ? "mes" : "parcial");
const MES = MODO === "mes";
const destino = process.env.DESTINO || (MES ? (process.env.EDNILSON_NUM || "") : "LÍDERES REGIONAL");
const agora = new Date(Date.now() - 3 * 3600e3);
const hora = process.env.HORA || `${String(agora.getUTCHours()).padStart(2, "0")}h`;
const data = agora.toISOString().slice(0, 10).split("-").reverse().join("/");

const ontem = process.env.MES_ATE ? new Date(`${process.env.MES_ATE}T12:00:00Z`) : new Date(Date.now() - 27 * 3600e3);
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const dm = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const dmy = (d) => `${dm(d)}/${d.getUTCFullYear()}`;
const mesNum = String(ontem.getUTCMonth() + 1).padStart(2, "0");
const cab = MES
  ? { data: `${MESES[ontem.getUTCMonth()]} ${ontem.getUTCFullYear()}`, hora: `01 a ${dm(ontem)}`, rodape: "Acumulado do mês até ontem" }
  : { data, hora };

const tenta = (f, ...a) => { try { return f(...a); } catch (e) { console.log("Ranking falhou:", e.message); return null; } };
const titulo = MES ? `mês, 01/${mesNum} a ${dm(ontem)}` : MODO === "final" ? `Resultado final do dia ${data}` : `${data} às ${hora}`;
const quando = MODO === "final" ? `${data} · resultado final do dia` : `${data} às ${hora}`;

const blocos = [
  ["saida/regional.png", `📊 *Resultado por Regional* — ${titulo}`, () => tenta(dadosRanking, "saida/regional.txt", 5), "saida/card-vendas.png"],
  ["saida/leads.png", `📋 *Painel Vendas Leads* — ${titulo}`, () => tenta(dadosRankingLeads, "saida/lojas.txt", 5), "saida/card-leads.png"],
];
const LINHA = "━━━━━━━━━━━━━━━━━━━━";
const espera = () => new Promise((r) => setTimeout(r, 2500));

// fotos "Por categoria": 1ª = dia (ontem no mês / hoje nos outros), 2ª = mês até agora
const hojeMes = String(agora.getUTCMonth() + 1).padStart(2, "0");
const legendasCat = MES
  ? [`Resultado por categoria - ${dmy(ontem)}`, `Resultado por categoria - Parcial do mês ${mesNum} - 01 a ${dm(ontem)}`]
  : [`Resultado por categoria - ${MODO === "final" ? "Resultado final do dia" : "Parcial do dia"} ${data}`,
     `Resultado por categoria - Parcial do mês ${hojeMes} - 01 a ${dm(agora)}`];

const sock = await conectar();
await new Promise((r) => setTimeout(r, 15000));
const jid = await acharDestino(sock, destino);
const mandar = async (msg, oque) => {
  for (let t = 1; ; t++) {
    try { await sock.sendMessage(jid, msg); console.log("✅ Enviado:", oque); return; }
    catch (e) { if (t >= 3) throw e; console.log(`Falhou (${oque}), tentando de novo:`, e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
};

if (MODO === "meta") {
  if (!fs.existsSync("saida/regional.png")) throw new Error("Faltou saida/regional.png");
  await mandar({ image: fs.readFileSync("saida/regional.png"), caption: `🎯 *META DO DIA* — ${data}` }, "meta do dia");
} else {
  let fotos = 0;
  for (const [i, [arq, legenda, rank, arqCard]] of blocos.entries()) {
    if (i > 0) { await mandar({ text: LINHA }, "linha"); await espera(); }
    if (!fs.existsSync(arq)) { console.log("Faltou", arq); continue; }
    await mandar({ image: fs.readFileSync(arq), caption: legenda }, arq); fotos++;
    await espera();
    const d = rank();
    if (!d) { console.log("Ranking não montado pra", arq); continue; }
    let card = null;
    if (process.env.CARD === "1") try { card = await desenharCard({ ...d, ...cab }, arqCard); } catch (e) { console.log("Card falhou, vai em texto:", e.message); }
    if (card) await mandar({ image: fs.readFileSync(card) }, card);
    else {
      const texto = MES ? textoMes(d, `Acumulado de 01/${mesNum} a ${dmy(ontem)}`) : textoHora(d, quando);
      await mandar({ text: texto }, "ranking (texto)\n" + texto);
    }
    await espera();
  }
  if (!fotos) throw new Error("Nenhum print do portal pra mandar");

  const cats = ["saida/categoria-dia.png", "saida/categoria-mes.png"];
  if (cats.some((c) => fs.existsSync(c))) {
    await mandar({ text: LINHA }, "linha"); await espera();
    for (const [i, c] of cats.entries()) {
      if (!fs.existsSync(c)) { console.log("⚠️ Faltou", c); continue; }
      await mandar({ image: fs.readFileSync(c), caption: legendasCat[i] }, c);
      await espera();
    }
  } else console.log("⚠️ Sem fotos de categoria (painel Netlify não respondeu)");
}

await new Promise((r) => setTimeout(r, 8000)); // garante a entrega
if (process.env.CHAVE) {
  const antigas = (() => { try { return fs.readFileSync("sessao/enviados.txt", "utf8").split("\n").filter(Boolean); } catch { return []; } })();
  fs.writeFileSync("sessao/enviados.txt", [...antigas, process.env.CHAVE].slice(-300).join("\n") + "\n");
  console.log("Marcado como enviado:", process.env.CHAVE);
}
await sock.end?.();
process.exit(0);
