// discomfort.js — recorrência FACTUAL de desconforto. Sem interpretação clínica,
// só contagem. Sem DOM.

import * as repo from "../data/repository.js";
import { rotuloRegiao } from "./dominio.js";

/**
 * Recorrência de uma região nos últimos N treinos realizados.
 * @returns {{regiao, comDesconforto, total, texto}}
 */
export async function recorrencia(regiao, ultimosN = 4) {
  const completed = await repo.listarCompleted(); // já vem recente-primeiro
  const ultimos = completed.slice(0, ultimosN);
  let com = 0;
  for (const c of ultimos) {
    const ds = await repo.listarDesconfortosPorTreino(c.id);
    if (ds.some((d) => d.regiao === regiao)) com++;
  }
  return {
    regiao,
    comDesconforto: com,
    total: ultimos.length,
    texto: `${rotuloRegiao(regiao)}: registrado em ${com} dos últimos ${ultimos.length} treinos.`,
  };
}

/**
 * Recorrência de todas as regiões que apareceram nos últimos N treinos.
 * @returns {Array<{regiao, comDesconforto, total, texto}>} ordenado por frequência.
 */
export async function recorrenciaTodas(ultimosN = 4) {
  const completed = await repo.listarCompleted();
  const ultimos = completed.slice(0, ultimosN);
  const contagem = {};
  for (const c of ultimos) {
    const ds = await repo.listarDesconfortosPorTreino(c.id);
    const regioesUnicas = new Set(ds.map((d) => d.regiao));
    for (const r of regioesUnicas) contagem[r] = (contagem[r] || 0) + 1;
  }
  return Object.entries(contagem)
    .map(([regiao, com]) => ({
      regiao,
      comDesconforto: com,
      total: ultimos.length,
      texto: `${rotuloRegiao(regiao)}: registrado em ${com} dos últimos ${ultimos.length} treinos.`,
    }))
    .sort((a, b) => b.comDesconforto - a.comDesconforto);
}
