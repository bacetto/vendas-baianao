// Roda DENTRO da página do portal (logada): usa o cliente de API do próprio portal.
// Uso: page.evaluate(coletarRawPainel, periodos)
async function coletarRawPainel(P) {
  let req;
  self.webpackChunk_N_E.push([[Symbol()], {}, (r) => { req = r; }]);
  let api = null;
  try { if (req(64665)?.x1?.get) api = req(64665).x1; } catch (e) {}
  // se o portal for atualizado e o número do módulo mudar: procura entre os módulos já carregados
  if (!api) for (const m of Object.values(req.c || {})) { const x = m?.exports?.x1; if (x?.get && x?.post) { api = x; break; } }
  if (!api) throw new Error("cliente de API do portal não encontrado");
  // o portal às vezes responde "Não foi possível conectar ao servidor": tenta de novo com espera crescente
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (u) => { for (let t = 0; ; t++) { try { return await api.get(u); } catch (e) { if (t >= 4) throw e; await espera(4000 * (t + 1)); } } };
  const q = (o) => new URLSearchParams(o).toString();
  const resumo = (x) => x ? get(`/vendas-lojas/resumo?${q({ dataInicio: x.inicio, dataFim: x.fim })}`) : null;
  const dados = (i, f) => get(`/analise-dinamica-produto/dados?${q({ dataInicio: i, dataFim: f })}`).then((r) => r.linhas || []);
  const leads = (i, f) => get(`/vendas-leads?${q({ dataInicio: i, dataFim: f, janelaDias: 15 })}`).catch(() => null);
  const filiais = async () => { const out = []; for (let pg = 1; pg < 20; pg++) { const r = await get(`/filiais?page=${pg}`); out.push(...r.items); if (pg >= r.pagination.totalPages) break; } return out; };
  // em lotes pequenos para não derrubar o servidor do portal
  const [fil, rH, rO, rM] = await Promise.all([filiais(), resumo(P.hoje), resumo(P.ontem), resumo(P.mes)]);
  const [rA, rAO, rAP] = await Promise.all([resumo(P.mesAnt), resumo(P.mesAteOntem), resumo(P.mesAntParcial)]);
  const dAt = await dados(P.mes.inicio, P.mes.fim);
  const dAn = await dados(P.mesAnt.inicio, P.mesAnt.fim);
  const [lH, lM] = await Promise.all([leads(P.hoje.inicio, P.hoje.fim), leads(P.mes.inicio, P.mes.fim)]);
  // mês cheio (meta do mês inteiro) e mês passado até o mesmo dia
  const [rC, rAH] = await Promise.all([resumo(P.mesCheio), resumo(P.mesAntAteHoje)]);
  // meta de cada dia do mês (pra linha da meta no gráfico) — vem em cache quando já foi lida hoje
  let metasDia = P.metasDia;
  if (!Array.isArray(metasDia) || metasDia.length !== P.diasMesAtual) {
    metasDia = [];
    for (let d0 = 1; d0 <= P.diasMesAtual; d0 += 5) {
      const lote = [];
      for (let d = d0; d < d0 + 5 && d <= P.diasMesAtual; d++) {
        const dia = `${P.mesCheio.inicio.slice(0, 8)}${String(d).padStart(2, "0")}`;
        lote.push(resumo({ inicio: dia, fim: dia }).then((r) => r?.geral?.mercantil?.meta || 0).catch(() => null));
      }
      metasDia.push(...(await Promise.all(lote)));
    }
  }
  // só o que o agregador usa (nada de cliente/CPF sai daqui)
  const enxuga = (ls) => ls.map((l) => ({ grupo: l.grupo, subgrupo: l.subgrupo, produto: l.produto, loja: l.loja, data: l.data, vendedor: l.vendedor, pedido: l.pedido, tipo: l.tipo, marca: l.marca, quantidade: l.quantidade, valorTotal: l.valorTotal }));
  const filEnx = fil.map((f) => ({ codigoProtheus: f.codigoProtheus, name: f.name, tradeName: f.tradeName, regional: f.regional }));
  return {
    agora: new Date().toISOString(), periodos: P, diasMesAtual: P.diasMesAtual, diasMesAnterior: P.diasMesAnterior,
    filiais: filEnx,
    resumo: { hoje: rH, ontem: rO, mes: rM, mesAnt: rA, mesAteOntem: rAO, mesAntParcial: rAP, mesCheio: rC, mesAntAteHoje: rAH },
    metasDia,
    dados: { atual: enxuga(dAt), anterior: enxuga(dAn) },
    leads: { hoje: lH, mes: lM },
  };
}
if (typeof module !== "undefined") module.exports = { coletarRawPainel };
