// agenda.js — semana-padrão, check de sessões e aderência semanal. Sem DOM.
//
// Fontes:
//   - weeklySchedule: o que está previsto em cada dia da semana (configurável)
//   - sessionLogs:    o que foi feito/não feito (musculação e karatê)
//   - plannedWorkouts do plano ativo: as corridas (registradas pelo fluxo da corrida)
// Os itens `corrida` da agenda são só referência visual (dia/período): a corrida
// do dia vem SEMPRE do plano.
//
// Definições (também na tela "Como calculamos"):
//   - previstos: itens não opcionais da semana + corridas do plano na semana
//   - aderência: feitos / previstos. Opcional feito e sessão fora da agenda
//     contam como extra
//   - Lower: sessões de musculação FEITAS com rótulo "Lower…", em qualquer dia
//   - sessão combinada (merge): não é um previsto novo nem extra. Cada origem
//     continua prevista uma vez e segue o status da combinada: feita => as
//     origens contam como feitas ("cobertas"); não feita => idem; pendente
//     => pendente. Os Lower cobertos contam no "Lower X de 2".

import * as repo from "../data/repository.js";
import { hoje as hojeISO, diaDaSemana, inicioDaSemana, somarDias } from "./dates.js";
import { corridaFeita } from "./dominio.js";
import { obterMetas } from "./metas.js";

export const ROTULO_TIPO = { musculacao: "Musculação", karate: "Karatê", corrida: "Corrida" };
export const ROTULO_PERIODO = { manha: "Manhã", noite: "Noite" };

// Feriados da semana carregada: no fim de semana e no feriado, o slot da noite é tarde/noite.
let feriadosDaSemana = new Set();

/** Rótulo do período naquele dia: "Manhã", "Noite" ou "Tarde". */
export function rotuloPeriodoNoDia(periodo, data) {
  if (periodo !== "noite" || !data) return ROTULO_PERIODO[periodo] || "";
  const dia = diaDaSemana(data);
  return dia === 0 || dia === 6 || feriadosDaSemana.has(data) ? "Tarde" : ROTULO_PERIODO.noite;
}
export const ROTULOS_SUGERIDOS = {
  musculacao: ["Upper A", "Upper B", "Lower A", "Lower B"],
  karate: ["Leve", "Intenso"],
  corrida: ["Corrida curta", "Corrida Z2"],
};
export const ROTULO_STATUS = { feito: "Feito", nao_feito: "Não feito" };

const ORDEM_PERIODO = { manha: 0, noite: 1 };

export function ehLower(rotulo) {
  return /^lower\b/i.test(String(rotulo || "").trim());
}
export function ehUpper(rotulo) {
  return /^upper\b/i.test(String(rotulo || "").trim());
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

// Treinos fora da agenda ficam depois dos previstos no mesmo período.
const ORDEM_AVULSA = 1000;

/**
 * Movimentos válidos da semana, por item. Ignora o movimento cujo item mudou de
 * dia na agenda depois de movido (a origem já não é o dia do item).
 */
function movimentosPorItem(agenda, movimentos) {
  const porId = new Map(agenda.map((i) => [i.id, i]));
  const r = new Map();
  for (const m of movimentos) {
    const item = porId.get(m.scheduleItemId);
    if (item && diaDaSemana(m.dataOrigem) === item.diaSemana) r.set(item.id, m);
  }
  return r;
}

/** A sessão `s` é o registro da própria ocorrência do item na semana (no dia previsto ou para onde foi movido)? */
function daOcorrencia(s, item, mov) {
  return mov ? s.data === mov.data : diaDaSemana(s.data) === item.diaSemana;
}

/**
 * Log feito em OUTRO dia da semana que vale por este item ("remanejado"): o
 * item não tem registro próprio na sua ocorrência, e existe uma sessão feita,
 * com o scheduleItemId dele, em outra data. `sessoes` deve cobrir só a semana.
 */
function remanejamentoDe(item, sessoes, mov = null) {
  const doItem = sessoes.filter((s) => s.scheduleItemId === item.id);
  if (doItem.some((s) => daOcorrencia(s, item, mov))) return null;
  return doItem.find((s) => s.status === "feito") || null;
}

/**
 * Monta as entradas de um dia (puro). `sessoes` e `movimentos` = os da SEMANA
 * (para enxergar remanejamentos e itens movidos). Tipos de entrada:
 *   {tipo:'sessao', item, log, remanejado, movimento}
 *        item da agenda (musculação/karatê) + registro do dia; `remanejado` = log
 *        feito em outro dia; `movimento` = o item foi arrastado para cá (ou de
 *        período) nesta semana
 *   {tipo:'corrida', planned, periodo}      treino do plano de corrida naquela data
 *   {tipo:'avulsa', log, item?, credita}    sessão fora da agenda; `credita` = vale pelo
 *                                           `item` de outro dia (não conta como extra)
 *   {tipo:'mesclada', merge}                sessão combinada (duas origens juntadas)
 * Entradas 'sessao' cujo registro está "mesclada" trazem `merge` (a combinada).
 * Toda entrada traz `periodo` e `ordem` (posição dentro do período).
 */
export function montarDia({ agenda, sessoes, corridas, movimentos = [], merges = [], data }) {
  const dow = diaDaSemana(data);
  const movs = movimentosPorItem(agenda, movimentos);
  const doDia = sessoes.filter((s) => s.data === data);
  const porItem = new Map(doDia.filter((s) => s.scheduleItemId).map((s) => [s.scheduleItemId, s]));
  const itensDoDia = ordenarAgenda(agenda.filter((i) => i.diaSemana === dow));
  const periodoCorrida = (itensDoDia.find((i) => i.tipo === "corrida") || {}).periodo || "manha";
  const agendaPorId = new Map(agenda.map((i) => [i.id, i]));

  // Ocorrências de hoje: itens do dia que não saíram + itens movidos para cá.
  const ocorrencias = [];
  for (const item of ordenarAgenda(agenda)) {
    if (item.tipo === "corrida") continue;
    const mov = movs.get(item.id) || null;
    if (mov ? mov.data === data : item.diaSemana === dow) ocorrencias.push({ item, mov });
  }

  const mergePorId = new Map(merges.map((m) => [m.id, m]));
  const entradas = [];
  for (const { item, mov } of ocorrencias) {
    const log = porItem.get(item.id) || null;
    entradas.push({
      tipo: "sessao", item, log, movimento: mov,
      periodo: mov ? mov.periodo : item.periodo,
      ordem: mov ? mov.ordem : item.ordem || 0,
      remanejado: log ? null : remanejamentoDe(item, sessoes, mov),
      merge: log && log.status === "mesclada" ? mergePorId.get(log.mergeId) || null : null,
    });
  }
  for (const m of merges.filter((x) => x.data === data)) {
    entradas.push({ tipo: "mesclada", merge: m, periodo: m.periodo, ordem: m.ordem || 0 });
  }
  for (const w of corridas.filter((c) => c.dataPlanejada === data)) {
    entradas.push({ tipo: "corrida", periodo: w.periodo || periodoCorrida, ordem: w.ordemDia ?? 0, planned: w });
  }
  const idsDoDia = new Set(ocorrencias.map((o) => o.item.id));
  for (const s of doDia) {
    if (!s.scheduleItemId || !idsDoDia.has(s.scheduleItemId)) {
      const item = s.scheduleItemId ? agendaPorId.get(s.scheduleItemId) || null : null;
      const credita = !!(item && s.status === "feito" && remanejamentoDe(item, sessoes, movs.get(item.id)) === s);
      entradas.push({ tipo: "avulsa", periodo: s.periodo || "manha", ordem: ORDEM_AVULSA, log: s, item, credita });
    }
  }
  // estável: manhã antes da noite; no período, pela ordem e depois pela inserção
  return entradas
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ORDEM_PERIODO[a.e.periodo] - ORDEM_PERIODO[b.e.periodo] || a.e.ordem - b.e.ordem || a.i - b.i)
    .map((x) => x.e);
}

/** Resumo de uma semana (puro). `inicio` é o primeiro dia da semana (ISO). */
/** Status efetivo de uma entrada 'sessao' (origem mesclada segue a combinada). */
export function statusDaSessao(e) {
  if (e.log && e.log.status === "mesclada") return e.merge ? e.merge.status : null;
  return e.log ? e.log.status : e.remanejado ? "feito" : null;
}

export function resumirSemana({ agenda, sessoes, corridas, movimentos = [], merges = [], inicio, metas }) {
  const r = {
    inicio, fim: somarDias(inicio, 6), dias: [],
    previstos: 0, feitos: 0, naoFeitos: 0, extras: 0,
    lower: 0, metaLower: metas.lowerPorSemana,
    // musculação: "4 de 4 cobertas (1 mesclada)"
    musculacao: { previstas: 0, cobertas: 0, mescladas: 0 },
  };
  for (let i = 0; i < 7; i++) {
    const data = somarDias(inicio, i);
    const entradas = montarDia({ agenda, sessoes, corridas, movimentos, merges, data });
    r.dias.push({ data, entradas });
    for (const e of entradas) {
      if (e.tipo === "sessao") {
        const st = statusDaSessao(e);
        if (e.item.opcional) {
          if (st === "feito") r.extras++;
        } else {
          r.previstos++;
          if (st === "feito") r.feitos++;
          else if (st === "nao_feito") r.naoFeitos++;
          if (e.item.tipo === "musculacao") {
            r.musculacao.previstas++;
            if (st === "feito") r.musculacao.cobertas++;
          }
        }
        // origem coberta por uma combinada feita (o registro dela é "mesclada")
        if (e.merge && st === "feito" && ehLower(e.item.rotulo)) r.lower++;
      } else if (e.tipo === "mesclada") {
        r.musculacao.mescladas++;
      } else if (e.tipo === "corrida") {
        r.previstos++;
        if (corridaFeita(e.planned.status)) r.feitos++;
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
  const [agenda, sessoes, movimentos, merges, plan, metas, excecoes] = await Promise.all([
    repo.listarAgenda(),
    repo.listarSessoes({ de, ate }),
    repo.listarMovimentos({ de, ate }),
    repo.listarMerges({ de, ate }),
    repo.planoAtivo(),
    obterMetas(),
    repo.listarExcecoes({ de, ate }),
  ]);
  feriadosDaSemana = new Set(excecoes.filter((x) => x.feriado).map((x) => x.data));
  const corridas = plan
    ? (await repo.listarPlanned({ planId: plan.id })).filter((w) => w.dataPlanejada >= de && w.dataPlanejada <= ate)
    : [];
  return { agenda, sessoes, movimentos, merges, corridas, metas };
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
 * igual a `rotulo`, e o item ainda sem registro no próprio dia nem outro
 * remanejamento.
 */
export function itemParaRemanejar({ agenda, sessoesSemana, tipo, rotulo, data }) {
  const r = norm(rotulo);
  const candidatos = agenda.filter((i) => {
    if (i.tipo !== tipo || i.opcional || !i.rotulo || i.diaSemana === diaDaSemana(data)) return false;
    return r && norm(i.rotulo) === r;
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

/**
 * Dá para arrastar? Fica onde está: corrida já registrada, item já feito em
 * outro dia (remanejado) e treino fora da agenda.
 */
export function podeMover(entrada) {
  if (entrada.tipo === "sessao") return !entrada.remanejado && !(entrada.log && entrada.log.status === "mesclada");
  if (entrada.tipo === "corrida") return !corridaFeita(entrada.planned.status);
  return false;
}

/**
 * Arrastar na semana: leva a entrada exibida em `dataAtual` para `destino`
 * {data, periodo, ordem}, na mesma semana. Item da agenda => movimento só desta
 * semana (a agenda-padrão não muda); corrida => reposiciona o treino do plano
 * (reagenda se mudar o dia).
 */
export function moverEntrada(entrada, dataAtual, { data, periodo, ordem }) {
  if (entrada.tipo === "corrida") return repo.reposicionarPlanned(entrada.planned.id, { data, periodo, ordemDia: ordem });
  if (entrada.tipo !== "sessao") throw new Error("Este treino não pode ser movido.");
  const mov = entrada.movimento;
  return repo.moverOcorrencia({
    scheduleItemId: entrada.item.id, dataOrigem: mov ? mov.dataOrigem : dataAtual, dataAtual, data, periodo, ordem,
  });
}

/** Desfaz o movimento da semana: o item volta ao dia e ao período da agenda. */
export function voltarAoPrevisto(entrada) {
  const mov = entrada.movimento;
  return repo.moverOcorrencia({
    scheduleItemId: entrada.item.id, dataOrigem: mov.dataOrigem, dataAtual: mov.data,
    data: mov.dataOrigem, periodo: entrada.item.periodo, voltar: true,
  });
}

/** Corrida: ✕ marca "não realizado"; tocar de novo devolve ao estado pendente. */
export function alternarCorridaNaoFeita(planned) {
  if (planned.status === "nao_realizado") {
    return repo.marcarStatusPlanned(planned.id, planned.dataOriginal ? "reagendado" : "futuro");
  }
  return repo.marcarStatusPlanned(planned.id, "nao_realizado");
}
