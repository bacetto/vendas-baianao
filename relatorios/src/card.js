// Desenha o ranking como um card (PNG) pra mandar no WhatsApp
import { chromium } from "playwright";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const barra = (p) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, p || 0))}%"></i></div>`;

// d = { tipo: "VENDAS" | "LEADS", data, hora, vazio, melhor, pior, top: [...], fundo: [...] }
//   regional: { nome, valor, info, p }   loja: { nome, reg, valor, info, p }
export function htmlCard(d) {
  const reg = (r, cls, rot) => `
    <div class="reg ${cls}">
      <div class="rot">${rot}</div>
      <div class="rnome">${esc(r.nome)}</div>
      <div class="rval">${esc(r.valor)}</div>
      <div class="rinfo">${esc(r.info)}</div>
      ${barra(r.p)}
    </div>`;
  const lista = (ls, cls, rot) => `
    <div class="sec ${cls}">
      <div class="stit">${rot}</div>
      ${ls.map((l, i) => `
        <div class="loja">
          <div class="pos">${i + 1}º</div>
          <div class="lmeio"><div class="lnome">${esc(l.nome)}</div><div class="lreg">${esc(l.reg)}</div></div>
          <div class="ldir"><div class="lval">${esc(l.valor)}</div><div class="linfo">${esc(l.info)}</div></div>
        </div>`).join("")}
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:900px;background:#0f1a2e;font-family:"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;color:#fff}
  .card{padding:36px}
  .topo{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:22px;border-bottom:2px solid #22324f;margin-bottom:24px}
  .marca{font-size:18px;letter-spacing:3px;color:#ffc93c;font-weight:700}
  h1{font-size:40px;font-weight:800;margin-top:4px}
  .quando{font-size:22px;color:#9fb0cc;text-align:right;line-height:1.3}
  .quando b{display:block;font-size:34px;color:#fff}
  .regs{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:24px}
  .reg{border-radius:18px;padding:22px 24px}
  .reg.bom{background:linear-gradient(135deg,#0f5132,#13794a)}
  .reg.ruim{background:linear-gradient(135deg,#6b1520,#9b2230)}
  .rot{font-size:17px;font-weight:700;letter-spacing:1.5px;opacity:.85}
  .rnome{font-size:32px;font-weight:800;margin:6px 0 10px}
  .rval{font-size:30px;font-weight:700}
  .rinfo{font-size:19px;opacity:.85;margin:4px 0 12px}
  .bar{height:10px;border-radius:5px;background:rgba(255,255,255,.2);overflow:hidden}
  .bar i{display:block;height:100%;background:#fff;border-radius:5px}
  .sec{background:#16233d;border-radius:18px;padding:18px 22px;margin-bottom:18px}
  .stit{font-size:20px;font-weight:800;letter-spacing:1px;margin-bottom:8px}
  .bom .stit{color:#4ade80}.ruim .stit{color:#f87171}
  .loja{display:flex;align-items:center;gap:16px;padding:12px 0;border-top:1px solid #22324f}
  .loja:first-of-type{border-top:0}
  .pos{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800;flex:none}
  .bom .pos{background:#14532d;color:#4ade80}.ruim .pos{background:#5f1a22;color:#f87171}
  .lmeio{flex:1;min-width:0}
  .lnome{font-size:23px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lreg{font-size:17px;color:#9fb0cc;margin-top:2px}
  .ldir{text-align:right;flex:none}
  .lval{font-size:23px;font-weight:700}
  .linfo{font-size:17px;color:#9fb0cc;margin-top:2px}
  .vazio{background:#16233d;border-radius:18px;padding:56px 24px;text-align:center;font-size:40px;font-weight:800;margin-bottom:18px}
  .vazio small{display:block;font-size:20px;font-weight:400;color:#9fb0cc;margin-top:10px}
  .rodape{text-align:center;color:#5d6f8f;font-size:15px;margin-top:6px}
  </style></head><body><div class="card">
    <div class="topo">
      <div><div class="marca">BAIANÃO</div><h1>Ranking ${esc(d.tipo)}</h1></div>
      <div class="quando">${esc(d.data)}<b>${esc(d.hora)}</b></div>
    </div>
    ${d.vazio ? `<div class="vazio">Sem vendas ainda<small>O ranking aparece assim que entrar a primeira venda</small></div>` : `
    <div class="regs">${reg(d.melhor, "bom", "▲ REGIONAL LÍDER")}${reg(d.pior, "ruim", "▼ REGIONAL FLOP")}</div>
    ${lista(d.top, "bom", `▲ ${d.top.length === 1 ? "LOJA LÍDER" : `${d.top.length} LOJAS LÍDERES`}`)}
    ${d.fundo.length ? lista(d.fundo, "ruim", `▼ ${d.fundo.length === 1 ? "LOJA FLOP" : `${d.fundo.length} LOJAS FLOP`}`) : ""}`}
    ${d.rodape ? `<div class="rodape">${esc(d.rodape)}</div>` : ""}
  </div></body></html>`;
}

export async function desenharCard(d, arq) {
  const browser = await chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : { channel: process.env.CHROME_CANAL || "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(htmlCard(d), { waitUntil: "load" });
    await page.locator(".card").screenshot({ path: arq });
  } finally { await browser.close(); }
  return arq;
}
