// metas.js — metas pessoais, editáveis em Ajustes → Metas. Sem DOM.
//
// Ficam numa única chave de settings ("metas"). Os valores abaixo são só o ponto
// de partida quando nada foi salvo; o app sempre lê o que você configurou.
// O app compara números com estas metas e nada além disso: sem alertas,
// diagnósticos ou recomendações.

import * as repo from "../data/repository.js";

export const METAS_PADRAO = {
  proteinaMinG: 150,
  proteinaMaxG: 170,
  ritmoMinKgSem: 0.3, // perda semanal, kg
  ritmoMaxKgSem: 0.5,
  pesoAlvoKg: 78,
  lowerPorSemana: 2,
  seriesPerna: { quadriceps: 10, posteriorGluteo: 8, panturrilha: 6 },
};

/** Mescla o salvo com os padrões (campo a campo, inclusive seriesPerna). */
export function mesclarMetas(salvas) {
  const s = salvas || {};
  return {
    ...METAS_PADRAO,
    ...s,
    seriesPerna: { ...METAS_PADRAO.seriesPerna, ...(s.seriesPerna || {}) },
  };
}

export async function obterMetas() {
  return mesclarMetas(await repo.obterConfig("metas", null));
}

/** Valida e salva. Lança Error com mensagem legível se algo estiver fora. */
export async function salvarMetas(metas) {
  const m = mesclarMetas(metas);
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const erros = [];
  if (!num(m.proteinaMinG) || !num(m.proteinaMaxG) || m.proteinaMinG <= 0 || m.proteinaMaxG < m.proteinaMinG) {
    erros.push("Proteína: o máximo precisa ser maior ou igual ao mínimo.");
  }
  if (!num(m.ritmoMinKgSem) || !num(m.ritmoMaxKgSem) || m.ritmoMinKgSem < 0 || m.ritmoMaxKgSem < m.ritmoMinKgSem) {
    erros.push("Ritmo: o máximo precisa ser maior ou igual ao mínimo.");
  }
  if (!num(m.pesoAlvoKg) || m.pesoAlvoKg <= 0) erros.push("Peso-alvo inválido.");
  if (!Number.isInteger(m.lowerPorSemana) || m.lowerPorSemana < 0) erros.push("Treinos de perna por semana inválido.");
  for (const [k, v] of Object.entries(m.seriesPerna)) {
    if (!Number.isInteger(v) || v < 0) erros.push(`Séries de ${k} inválido.`);
  }
  if (erros.length) throw new Error(erros.join(" "));
  await repo.definirConfig("metas", m);
  return m;
}
