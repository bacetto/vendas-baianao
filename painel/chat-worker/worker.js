// "Pergunte ao painel": recebe a pergunta + os números agregados do painel e responde com IA (Cloudflare Workers AI).
// Só aceita quem sabe a senha do painel (o navegador manda o SHA-256 dela). Não guarda nada.
const ORIGENS = ["https://bacetto.github.io", "https://vendas-baianao.netlify.app"];
const MODELOS = ["@cf/openai/gpt-oss-120b", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
const SISTEMA = `Você é o analista de vendas da rede Baianão Móveis e Eletro (cerca de 40 lojas na Bahia, regionais R1 a R4, cada uma com um líder).
Há duas plataformas de venda: Universo Baianão (principal, com metas) e ZepSystem (mesmas lojas e vendedores, sem meta).
Você responde perguntas do dono e dos gestores usando SOMENTE os dados do JSON enviado (números do momento, já formatados: copie como estão, nunca converta nem invente).
Os blocos "hoje", "ontem", "mes" e "mesPassado" são PERÍODOS DIFERENTES: ao falar de um período, use só números daquele bloco e sempre diga o período (ex.: "no mês", "hoje"). Nunca misture a meta/venda de hoje com a do mês.
Se a resposta não estiver nos dados, diga claramente que o painel não tem essa informação e sugira o que dá pra ver.
Responda em português do Brasil, direto e profissional: comece pela resposta, depois os números que sustentam, e quando fizer sentido uma sugestão prática.
Use listas curtas quando ajudar. Pode usar **negrito** para números importantes. Tabela só se for pequena (até 6 linhas).
Nunca crie números que não estão nos dados (nada de "R$ 30 mil/dia" ou "10% de desconto" inventados). Se precisar de uma conta simples (soma, diferença), mostre de onde veio e diga que é estimativa.
Sugestões práticas devem citar quem faz (líder da regional, gerente da loja X) e se apoiar em um número dos dados.`;

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ORIGENS.includes(origin) ? origin : ORIGENS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Chave",
  "Access-Control-Max-Age": "86400",
});
const json = (o, st, origin) => new Response(JSON.stringify(o), { status: st, headers: { "Content-Type": "application/json", ...cors(origin) } });

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    if (req.method !== "POST") return json({ erro: "use POST" }, 405, origin);
    if (!env.CHAVE || req.headers.get("X-Chave") !== env.CHAVE) return json({ erro: "acesso negado" }, 401, origin);
    let b;
    try { b = await req.json(); } catch (e) { return json({ erro: "corpo inválido" }, 400, origin); }
    const pergunta = String(b.pergunta || "").slice(0, 1500).trim();
    if (!pergunta) return json({ erro: "sem pergunta" }, 400, origin);
    const ctx = JSON.stringify(b.contexto || {}).slice(0, 120000);
    const hist = (Array.isArray(b.historico) ? b.historico : []).slice(-6)
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 3000) }));
    const messages = [{ role: "system", content: SISTEMA }, { role: "system", content: "DADOS DO PAINEL (JSON):\n" + ctx }, ...hist, { role: "user", content: pergunta }];
    for (const model of MODELOS) {
      try {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/chat/completions`, {
          method: "POST", headers: { Authorization: `Bearer ${env.CF_AI_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 4000, reasoning_effort: "low" }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const txt = String(j.choices?.[0]?.message?.content || "").trim();
        if (txt) return json({ resposta: txt, modelo: model.split("/").pop() }, 200, origin);
      } catch (e) {}
    }
    return json({ erro: "a IA não respondeu agora, tente de novo em instantes" }, 502, origin);
  },
};
