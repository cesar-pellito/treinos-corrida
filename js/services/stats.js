// stats.js — cálculos de progresso e séries para a Evolução. Sem DOM.
// Junta completedWorkouts com plannedWorkouts (via plannedWorkoutId) e mapeia
// tudo para a semana do plano.

import * as repo from "../data/repository.js";
import { diffDias } from "./dates.js";
import { rotuloTipo } from "./dominio.js";

const TIPOS_FACEIS = ["continua", "longa", "corrida_caminhada"];

/** Semana do plano para uma data (1..totalSemanas), clampada. */
function semanaDe(plan, dataISO) {
  const s = Math.floor(diffDias(plan.dataInicio, dataISO) / 7) + 1;
  return Math.max(1, Math.min(plan.totalSemanas || 22, s));
}

/** Carrega e junta os dados uma vez. */
async function carregarJoin(plan) {
  const [completed, planned] = await Promise.all([
    repo.listarCompleted(),
    repo.listarPlanned({ planId: plan.id }),
  ]);
  const plannedPorId = new Map(planned.map((w) => [w.id, w]));
  const itens = completed.map((c) => {
    const p = c.plannedWorkoutId ? plannedPorId.get(c.plannedWorkoutId) : null;
    return {
      c,
      planned: p,
      tipo: p ? p.tipo : (c.tipoAvulso || "avulso"),
      semana: p ? p.semana : semanaDe(plan, c.data),
    };
  });
  return { itens, planned };
}

/** Séries semanais para os gráficos. */
export async function seriesSemanais(plan, { tipoFacil = null } = {}) {
  const { itens, planned } = await carregarJoin(plan);
  const totalSem = plan.totalSemanas || 22;
  const faceis = tipoFacil ? [tipoFacil] : TIPOS_FACEIS;

  const linhas = [];
  for (let s = 1; s <= totalSem; s++) {
    const doPlano = planned.filter((w) => w.semana === s);
    const feitosSemana = itens.filter((i) => i.semana === s);
    const faceisSemana = feitosSemana.filter((i) => faceis.includes(i.tipo) && i.c.paceSegPorKm != null);
    const fcFaceis = feitosSemana.filter((i) => faceis.includes(i.tipo) && i.c.fcMedia != null);
    const comRpe = feitosSemana.filter((i) => i.c.rpe != null);

    const minutos = Math.round(feitosSemana.reduce((a, i) => a + (i.c.duracaoSeg || 0), 0) / 60);
    const km = Math.round(feitosSemana.reduce((a, i) => a + (i.c.distanciaMetros || 0), 0) / 100) / 10;
    const concluidos = doPlano.filter((w) => w.status === "concluido").length;

    linhas.push({
      semana: s,
      minutos,
      km,
      aderencia: doPlano.length ? concluidos / doPlano.length : null,
      concluidos,
      planejados: doPlano.length,
      paceFacil: media(faceisSemana.map((i) => i.c.paceSegPorKm)),
      fcFacil: media(fcFaceis.map((i) => i.c.fcMedia)),
      rpeMedio: media(comRpe.map((i) => i.c.rpe)),
    });
  }
  return linhas;
}

function media(arr) {
  const v = arr.filter((x) => x != null);
  if (!v.length) return null;
  return v.reduce((a, x) => a + x, 0) / v.length;
}

/** Aderência acumulada e da semana atual. */
export async function aderencia(plan, semanaAtual) {
  const planned = await repo.listarPlanned({ planId: plan.id });
  const ateAgora = planned.filter((w) => w.semana <= semanaAtual);
  const concl = ateAgora.filter((w) => w.status === "concluido").length;
  const daSemana = planned.filter((w) => w.semana === semanaAtual);
  const conclSem = daSemana.filter((w) => w.status === "concluido").length;
  return {
    acumuladaPct: ateAgora.length ? Math.round((concl / ateAgora.length) * 100) : 0,
    semanaPct: daSemana.length ? Math.round((conclSem / daSemana.length) * 100) : 0,
    concluidos: concl,
    planejados: ateAgora.length,
  };
}

/** Volume acumulado desde o início (minutos e km reais). */
export async function acumulado() {
  const completed = await repo.listarCompleted();
  const seg = completed.reduce((a, c) => a + (c.duracaoSeg || 0), 0);
  const metros = completed.reduce((a, c) => a + (c.distanciaMetros || 0), 0);
  return { minutos: Math.round(seg / 60), km: Math.round(metros / 100) / 10, treinos: completed.length };
}

/** Recordes pessoais. */
export async function recordes() {
  const completed = await repo.listarCompleted();
  const comDist = completed.filter((c) => c.distanciaMetros != null);
  const comDur = completed.filter((c) => c.duracaoSeg != null);
  const comPace = completed.filter((c) => c.paceSegPorKm != null && c.distanciaMetros >= 1000);
  const max = (arr, f) => (arr.length ? arr.reduce((a, b) => (f(b) > f(a) ? b : a)) : null);
  const min = (arr, f) => (arr.length ? arr.reduce((a, b) => (f(b) < f(a) ? b : a)) : null);
  return {
    maiorDistancia: max(comDist, (c) => c.distanciaMetros),
    maiorDuracao: max(comDur, (c) => c.duracaoSeg),
    melhorPace: min(comPace, (c) => c.paceSegPorKm),
  };
}

/**
 * Comparação com um treino semelhante anterior (mesmo tipo, com pace).
 * Retorna {anterior, texto} ou null.
 */
export async function comparacaoSemelhante(completed) {
  if (completed.paceSegPorKm == null) return null;
  const plan = await repo.planoAtivo();
  if (!plan) return null;
  const { itens } = await carregarJoin(plan);
  const atualTipo = completed.plannedWorkoutId
    ? (itens.find((i) => i.c.id === completed.id)?.tipo || null)
    : "avulso";
  if (!atualTipo) return null;

  const candidatos = itens
    .filter((i) => i.c.id !== completed.id && i.tipo === atualTipo && i.c.paceSegPorKm != null && i.c.data < completed.data)
    .sort((a, b) => (a.c.data > b.c.data ? -1 : 1));
  if (!candidatos.length) return null;

  const ant = candidatos[0].c;
  const semanas = Math.round(diffDias(ant.data, completed.data) / 7);
  const quando = semanas <= 0 ? "recentemente" : `${semanas} ${semanas === 1 ? "semana" : "semanas"} atrás`;
  const fmt = (p) => `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, "0")}`;
  return {
    anterior: ant,
    texto: `${rotuloTipo(atualTipo)}: hoje ${fmt(completed.paceSegPorKm)} /km, ${quando} ${fmt(ant.paceSegPorKm)} /km.`,
  };
}
