// agenda.js — semana-padrão, check de sessões e aderência semanal. Sem DOM.
//
// Fontes:
//   - weeklySchedule: o que está previsto em cada dia da semana (configurável)
//   - sessionLogs:    o que foi feito/não feito/pulado (musculação e karatê)
//   - plannedWorkouts do plano ativo: as corridas (registradas pelo fluxo da corrida)
// Os itens `corrida` da agenda são só referência visual (dia/período): a corrida
// do dia vem SEMPRE do plano.
//
// Definições (também na tela "Como calculamos"):
//   - previstos: itens não opcionais da semana + corridas do plano na semana
//   - aderência: feitos / previstos. Opcional feito e sessão fora da agenda
//     contam como extra; "pulado" aparece separado e não conta como feito
//   - Lower: sessões de musculação FEITAS com rótulo "Lower…", em qualquer dia

import * as repo from "../data/repository.js";
import { hoje as hojeISO, diaDaSemana, inicioDaSemana, somarDias } from "./dates.js";
import { obterMetas } from "./metas.js";

export const ROTULO_TIPO = { musculacao: "Musculação", karate: "Karatê", corrida: "Corrida" };
export const ROTULO_PERIODO = { manha: "Manhã", noite: "Noite" };
export const ROTULOS_SUGERIDOS = {
  musculacao: ["Upper A", "Upper B", "Lower A", "Lower B"],
  karate: ["Leve", "Intenso"],
  corrida: ["Corrida curta", "Corrida Z2"],
};
export const ROTULO_STATUS = { feito: "Feito", nao_feito: "Não feito", pulado: "Pulado" };

const ORDEM_PERIODO = { manha: 0, noite: 1 };

export function ehLower(rotulo) {
  return /^lower\b/i.test(String(rotulo || "").trim());
}

/** Ordena itens da agenda pela semana (a partir de primeiroDiaSemana), período e ordem. */
export function ordenarAgenda(itens, primeiroDiaSemana = 1) {
  const pos = (d) => (d - primeiroDiaSemana + 7) % 7;
  return [...itens].sort((a, b) =>
    pos(a.diaSemana) - pos(b.diaSemana) ||
    ORDEM_PERIODO[a.periodo] - ORDEM_PERIODO[b.periodo] ||
    (a.ordem || 0) - (b.ordem || 0)
  );
}

/** Snapshot do item gravado na sessão (editar a agenda depois não reescreve o histórico). */
export function snapshotItem(item) {
  return { tipo: item.tipo, rotulo: item.rotulo, periodo: item.periodo, opcional: !!item.opcional };
}

/**
 * Log feito em OUTRO dia da semana que vale por este item ("remanejado"): o
 * item não tem registro próprio no seu dia, e existe uma sessão feita, com o
 * scheduleItemId dele, em outra data. `sessoes` deve cobrir só a semana.
 */
function remanejamentoDe(item, sessoes) {
  const proprio = sessoes.some((s) => s.scheduleItemId === item.id && diaDaSemana(s.data) === item.diaSemana);
  if (proprio) return null;
  return sessoes.find((s) => s.scheduleItemId === item.id && s.status === "feito" && diaDaSemana(s.data) !== item.diaSemana) || null;
}

/**
 * Monta as entradas de um dia (puro). `sessoes` = as da SEMANA (para enxergar
 * remanejamentos). Tipos de entrada:
 *   {tipo:'sessao', item, log, remanejado}  item da agenda (musculação/karatê) + registro
 *                                           do dia; `remanejado` = log feito em outro dia
 *   {tipo:'corrida', planned, periodo}      treino do plano de corrida naquela data
 *   {tipo:'avulsa', log, item?, credita}    sessão fora da agenda; `credita` = vale pelo
 *                                           `item` de outro dia (não conta como extra)
 */
export function montarDia({ agenda, sessoes, corridas, data }) {
  const dow = diaDaSemana(data);
  const itens = ordenarAgenda(agenda.filter((i) => i.diaSemana === dow));
  const doDia = sessoes.filter((s) => s.data === data);
  const porItem = new Map(doDia.filter((s) => s.scheduleItemId).map((s) => [s.scheduleItemId, s]));
  const periodoCorrida = (itens.find((i) => i.tipo === "corrida") || {}).periodo || "manha";
  const agendaPorId = new Map(agenda.map((i) => [i.id, i]));

  const entradas = [];
  for (const item of itens) {
    if (item.tipo === "corrida") continue;
    const log = porItem.get(item.id) || null;
    entradas.push({ tipo: "sessao", periodo: item.periodo, item, log, remanejado: log ? null : remanejamentoDe(item, sessoes) });
  }
  for (const w of corridas.filter((c) => c.dataPlanejada === data)) {
    entradas.push({ tipo: "corrida", periodo: periodoCorrida, planned: w });
  }
  const idsDoDia = new Set(itens.map((i) => i.id));
  for (const s of doDia) {
    if (!s.scheduleItemId || !idsDoDia.has(s.scheduleItemId)) {
      const item = s.scheduleItemId ? agendaPorId.get(s.scheduleItemId) || null : null;
      const credita = !!(item && s.status === "feito" && remanejamentoDe(item, sessoes) === s);
      entradas.push({ tipo: "avulsa", periodo: s.periodo || "manha", log: s, item, credita });
    }
  }
  // estável: manhã antes da noite, mantendo a ordem de inserção dentro do período
  return entradas
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ORDEM_PERIODO[a.e.periodo] - ORDEM_PERIODO[b.e.periodo] || a.i - b.i)
    .map((x) => x.e);
}

/** Resumo de uma semana (puro). `inicio` é o primeiro dia da semana (ISO). */
export function resumirSemana({ agenda, sessoes, corridas, inicio, metas }) {
  const r = {
    inicio, fim: somarDias(inicio, 6), dias: [],
    previstos: 0, feitos: 0, pulados: 0, naoFeitos: 0, extras: 0,
    lower: 0, metaLower: metas.lowerPorSemana,
  };
  for (let i = 0; i < 7; i++) {
    const data = somarDias(inicio, i);
    const entradas = montarDia({ agenda, sessoes, corridas, data });
    r.dias.push({ data, entradas });
    for (const e of entradas) {
      if (e.tipo === "sessao") {
        const st = e.log ? e.log.status : e.remanejado ? "feito" : null;
        if (e.item.opcional) {
          if (st === "feito") r.extras++;
        } else {
          r.previstos++;
          if (st === "feito") r.feitos++;
          else if (st === "pulado") r.pulados++;
          else if (st === "nao_feito") r.naoFeitos++;
        }
      } else if (e.tipo === "corrida") {
        r.previstos++;
        if (e.planned.status === "concluido") r.feitos++;
        else if (e.planned.status === "nao_realizado") r.naoFeitos++;
      } else if (e.tipo === "avulsa" && e.log.status === "feito" && !e.credita) {
        r.extras++; // a que credita um item já contou como "feito" no dia do item
      }
      const log = e.log;
      if (log && log.status === "feito" && log.tipo === "musculacao" && ehLower(log.rotulo)) r.lower++;
    }
  }
  return r;
}

async function carregarBase(de, ate) {
  const [agenda, sessoes, plan, metas] = await Promise.all([
    repo.listarAgenda(),
    repo.listarSessoes({ de, ate }),
    repo.planoAtivo(),
    obterMetas(),
  ]);
  const corridas = plan
    ? (await repo.listarPlanned({ planId: plan.id })).filter((w) => w.dataPlanejada >= de && w.dataPlanejada <= ate)
    : [];
  return { agenda, sessoes, corridas, metas };
}

export async function primeiroDiaSemana() {
  return repo.obterConfig("primeiroDiaSemana", 1);
}

/** Semana que contém `dataRef`. */
export async function carregarSemana(dataRef = hojeISO()) {
  const inicio = inicioDaSemana(dataRef, await primeiroDiaSemana());
  const base = await carregarBase(inicio, somarDias(inicio, 6));
  return resumirSemana({ ...base, inicio });
}

/** Entradas de um dia (lê a semana inteira para enxergar remanejamentos). */
export async function carregarDia(data = hojeISO()) {
  const inicio = inicioDaSemana(data, await primeiroDiaSemana());
  const base = await carregarBase(inicio, somarDias(inicio, 6));
  return montarDia({ ...base, data });
}

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Item da agenda que uma sessão feita em `data` (fora do dia previsto) pode
 * cumprir, na mesma semana (puro). Critério: mesmo tipo, não opcional, rótulo
 * igual a `rotulo` OU contido em `nomeLivre` (ex.: nome do treino no Gravl), e
 * o item ainda sem registro no próprio dia nem outro remanejamento.
 */
export function itemParaRemanejar({ agenda, sessoesSemana, tipo, rotulo, nomeLivre, data }) {
  const r = norm(rotulo), n = norm(nomeLivre);
  const candidatos = agenda.filter((i) => {
    if (i.tipo !== tipo || i.opcional || !i.rotulo || i.diaSemana === diaDaSemana(data)) return false;
    const ir = norm(i.rotulo);
    return (r && ir === r) || (n && n.includes(ir));
  });
  return candidatos.find((i) => !sessoesSemana.some((s) => s.scheduleItemId === i.id)) || null;
}

/** Agenda ordenada pela semana do usuário (para o editor). */
export async function listarAgendaOrdenada() {
  return ordenarAgenda(await repo.listarAgenda(), await primeiroDiaSemana());
}

// ---------------------------------------------------------------------------
// Escritas (via repository)
// ---------------------------------------------------------------------------

export function salvarItemAgenda(item) {
  return repo.salvarItemAgenda(item);
}
export function removerItemAgenda(item) {
  return repo.removerItemAgenda(item.id);
}

/** Marca o item da agenda num dia. Mesmo (data, item) => edita, não duplica. */
export function marcarSessao(item, data, status, extras = {}) {
  return repo.registrarSessao({ data, scheduleItemId: item.id, ...snapshotItem(item), status, ...extras });
}

/** 1 toque: escolhe o status; tocar de novo no status ativo desmarca. */
export function alternarSessao(item, data, status, logAtual) {
  if (logAtual && logAtual.status === status) return repo.removerSessao(logAtual.id);
  return marcarSessao(item, data, status);
}

/** Agenda e sessões da semana de `data` (para remanejamento). */
export async function carregarSemanaCrua(data) {
  const inicio = inicioDaSemana(data, await primeiroDiaSemana());
  const [agenda, sessoesSemana] = await Promise.all([
    repo.listarAgenda(),
    repo.listarSessoes({ de: inicio, ate: somarDias(inicio, 6) }),
  ]);
  return { agenda, sessoesSemana };
}

/**
 * Sessão fora do dia previsto (ex.: Lower A no sábado). Sempre "feito". Se um
 * item da agenda da mesma semana, com o mesmo tipo e rótulo, ainda não foi
 * feito, a sessão é vinculada a ele (remanejamento): conta na aderência no
 * lugar do item. Senão, fica como extra.
 */
export async function registrarSessaoAvulsa({ data, tipo, rotulo, periodo, duracaoMin = null, rpe = null }) {
  const { agenda, sessoesSemana } = await carregarSemanaCrua(data);
  const item = itemParaRemanejar({ agenda, sessoesSemana, tipo, rotulo, data });
  return repo.registrarSessao({
    data, scheduleItemId: item ? item.id : null, tipo, rotulo, periodo, opcional: false, status: "feito", duracaoMin, rpe,
  });
}

/** Edita duração/RPE (e status, se vier) de uma sessão já registrada. */
export function editarSessao(log, alteracoes) {
  return repo.atualizarSessao(log.id, alteracoes);
}

/** Remove o registro (tombstone). */
export function desmarcarSessao(log) {
  return repo.removerSessao(log.id);
}

/** Corrida: ✕ marca "não realizado"; tocar de novo devolve ao estado pendente. */
export function alternarCorridaNaoFeita(planned) {
  if (planned.status === "nao_realizado") {
    return repo.marcarStatusPlanned(planned.id, planned.dataOriginal ? "reagendado" : "futuro");
  }
  return repo.marcarStatusPlanned(planned.id, "nao_realizado");
}
