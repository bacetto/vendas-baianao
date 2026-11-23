// Roda a análise de IA FORA do ciclo da coleta (em segundo plano), pra IA lenta ou sem cota nunca atrasar o painel.
import fs from "node:fs";
import { analiseIA } from "./ia.mjs";
const D = JSON.parse(fs.readFileSync("saida/dados-ia.json", "utf8"));
await analiseIA(D).catch((e) => console.log("⚠️ IA:", String(e.message).slice(0, 120)));
process.exit(0);
