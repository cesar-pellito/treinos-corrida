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
  lowerPorSemana: 2,
};

/** Mescla o salvo com os padrões (campos de versões antigas são descartados). */
export function mesclarMetas(salvas) {
  const s = salvas || {};
  const m = { ...METAS_PADRAO };
  for (const k of Object.keys(METAS_PADRAO)) if (s[k] !== undefined) m[k] = s[k];
  return m;
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
  if (!Number.isInteger(m.lowerPorSemana) || m.lowerPorSemana < 0) erros.push("Treinos de perna por semana inválido.");
  if (erros.length) throw new Error(erros.join(" "));
  await repo.definirConfig("metas", m);
  return m;
}
