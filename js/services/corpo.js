// corpo.js — pesagens, InBody, média móvel e ritmo de perda. Sem DOM.
//
// Definições (também na tela "Como calculamos"):
//   - valor do dia: média das pesagens daquele dia (InBody fica fora: é referência)
//   - média móvel de 7 dias em d: média dos valores diários em [d−6, d]
//   - ritmo semanal: média 7d de hoje − média 7d de 7 dias atrás, expresso como
//     perda (positivo = perdeu). Só existe se houver pesagem nas duas janelas.
// O app só compara esses números com a faixa que você configurou em Metas.

import * as repo from "../data/repository.js";
import { obterMetas } from "./metas.js";
import { hoje as hojeISO, somarDias } from "./dates.js";

const arred = (n, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

/** [{data, peso}] — um valor por dia (média das pesagens do dia), em ordem. */
export function serieDiaria(pesagens) {
  const porDia = new Map();
  for (const p of pesagens) {
    if (p.removido || p.tipo === "inbody" || typeof p.pesoKg !== "number") continue;
    if (!porDia.has(p.data)) porDia.set(p.data, []);
    porDia.get(p.data).push(p.pesoKg);
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([data, ps]) => ({ data, peso: arred(ps.reduce((a, x) => a + x, 0) / ps.length) }));
}

/** Média 7d terminando em `data` (null se não há pesagem na janela). */
export function mediaEm(serie, data) {
  const de = somarDias(data, -6);
  const janela = serie.filter((p) => p.data >= de && p.data <= data);
  if (!janela.length) return null;
  return arred(janela.reduce((a, p) => a + p.peso, 0) / janela.length);
}

/** Média móvel 7d em cada dia com pesagem. */
export function mediaMovel7(serie) {
  return serie.map((p) => ({ ...p, media: mediaEm(serie, p.data) }));
}

/**
 * Ritmo da semana que termina em `data`: perda em kg (positivo = perdeu).
 * @returns {{kgSemana:number, atual:number, anterior:number} | null}
 */
export function ritmoSemanal(serie, data = hojeISO()) {
  const atual = mediaEm(serie, data);
  const anterior = mediaEm(serie, somarDias(data, -7));
  if (atual == null || anterior == null) return null;
  return { kgSemana: arred(anterior - atual), atual, anterior };
}

/** Ritmo das últimas `n` semanas (a mais antiga primeiro), terminando em `data`. */
export function historicoRitmo(serie, n = 8, data = hojeISO()) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const fim = somarDias(data, -7 * k);
    const r = ritmoSemanal(serie, fim);
    out.push({ fim, kgSemana: r ? r.kgSemana : null });
  }
  return out;
}

/** Posição do ritmo em relação à faixa configurada (só descreve, não recomenda). */
export function situacaoRitmo(kgSemana, metas) {
  if (kgSemana == null) return null;
  if (kgSemana < metas.ritmoMinKgSem) return "abaixo da faixa";
  if (kgSemana > metas.ritmoMaxKgSem) return "acima da faixa";
  return "dentro da faixa";
}

/** Tudo que as telas precisam, numa leitura. */
export async function carregarCorpo(data = hojeISO()) {
  const [medidas, metas] = await Promise.all([repo.listarMedidas(), obterMetas()]);
  const pesagens = medidas.filter((m) => m.tipo === "pesagem");
  const inbody = medidas.filter((m) => m.tipo === "inbody");
  const serie = serieDiaria(pesagens);
  const ultima = pesagens.length ? pesagens[pesagens.length - 1] : null;
  const media7 = mediaEm(serie, data);
  const ritmo = ritmoSemanal(serie, data);
  return {
    metas, pesagens, inbody, serie,
    comMedia: mediaMovel7(serie),
    ultima, media7, ritmo,
    situacao: situacaoRitmo(ritmo && ritmo.kgSemana, metas),
    faltamKg: media7 != null ? arred(media7 - metas.pesoAlvoKg, 1) : null,
    historico: historicoRitmo(serie, 8, data),
  };
}

// ---------------------------------------------------------------------------
// Escritas (via repository)
// ---------------------------------------------------------------------------
export function salvarPesagem({ id, criadoEm, data = hojeISO(), hora = null, pesoKg, gorduraPct = null, massaMuscularKg = null, gorduraVisceral = null }) {
  return repo.salvarMedida({ id, criadoEm, tipo: "pesagem", fonte: "balanca", data, hora, pesoKg, gorduraPct, massaMuscularKg, gorduraVisceral });
}
export function salvarInBody({ id, criadoEm, data, pesoKg, massaGorduraKg, massaLivreGorduraKg, massaMuscularEsqueleticaKg, gorduraPct }) {
  return repo.salvarMedida({ id, criadoEm, tipo: "inbody", fonte: "inbody", data, pesoKg, massaGorduraKg, massaLivreGorduraKg, massaMuscularEsqueleticaKg, gorduraPct });
}
export function removerMedida(m) {
  return repo.removerMedida(m.id);
}
