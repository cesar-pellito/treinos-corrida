// schedule.js — regras de agenda derivadas do plano. Sem DOM.
// Lê via repository; calcula "treino de hoje", próximo, anterior, semana atual,
// progresso da semana e streak. Status 'hoje' é DERIVADO (não persistido).

import * as repo from "../data/repository.js";
import { hoje as hojeISO, diffDias, somarDias } from "./dates.js";

/**
 * Status efetivo para exibição (derivado, não persistido):
 *   - 'hoje'    quando a data planejada é hoje
 *   - 'perdido' quando um treino pendente ficou no passado
 */
export function statusEfetivo(planned, hoje = hojeISO()) {
  if (planned.status === "concluido" || planned.status === "nao_realizado") return planned.status;
  if (planned.dataPlanejada === hoje) return "hoje";
  if (planned.dataPlanejada < hoje) return "perdido";
  return planned.status; // 'futuro' | 'reagendado' (no futuro)
}

/**
 * Remarca um treino para novaData e EMPURRA todos os treinos pendentes
 * posteriores pelo mesmo número de dias, estendendo o prazo final do plano
 * (preserva o espaçamento). Devolve a nova data final do plano.
 */
export async function remarcarEmpurrando(plan, workout, novaData) {
  const delta = diffDias(workout.dataPlanejada, novaData);
  const planned = await repo.listarPlanned({ planId: plan.id });
  if (delta !== 0) {
    // ordena p/ evitar colisões; se empurrando para frente, move os mais tarde primeiro
    const posteriores = planned
      .filter((w) => w.id !== workout.id && w.dataPlanejada > workout.dataPlanejada &&
        (w.status === "futuro" || w.status === "reagendado"))
      .sort((a, b) => (delta > 0 ? (a.dataPlanejada < b.dataPlanejada ? 1 : -1) : (a.dataPlanejada < b.dataPlanejada ? -1 : 1)));
    for (const w of posteriores) await repo.reagendarPlanned(w.id, somarDias(w.dataPlanejada, delta));
  }
  await repo.reagendarPlanned(workout.id, novaData);

  const atualizados = await repo.listarPlanned({ planId: plan.id });
  const fim = atualizados.reduce((max, w) => (w.dataPlanejada > max ? w.dataPlanejada : max), "");
  return { novoFim: fim, empurrados: delta };
}

/** Número da semana atual do plano (1..totalSemanas), a partir da data de início. */
export function semanaAtual(plan, hoje = hojeISO()) {
  const dias = diffDias(plan.dataInicio, hoje);
  const semana = Math.floor(dias / 7) + 1;
  return Math.max(1, Math.min(plan.totalSemanas || 22, semana));
}

/** Encontra a fase que contém uma dada semana. */
export function faseDaSemana(fases, semana) {
  return fases.find((f) => semana >= f.semanaInicio && semana <= f.semanaFim) || null;
}

/**
 * Monta o resumo para a tela Hoje numa única passada.
 * @returns {{hoje, proximo, anterior, diasParaProximo, semana, fase, progresso, streak}}
 */
export async function resumoHoje(plan, hoje = hojeISO()) {
  const [planned, fases] = await Promise.all([
    repo.listarPlanned({ planId: plan.id }),
    repo.listarFases(plan.id),
  ]);

  const treinoHoje = planned.find((w) => w.dataPlanejada === hoje) || null;

  const futuros = planned
    .filter((w) => w.dataPlanejada > hoje && w.status !== "concluido" && w.status !== "nao_realizado")
    .sort((a, b) => (a.dataPlanejada < b.dataPlanejada ? -1 : 1));
  const proximo = futuros[0] || null;

  const passados = planned
    .filter((w) => w.dataPlanejada < hoje)
    .sort((a, b) => (a.dataPlanejada > b.dataPlanejada ? -1 : 1));
  const anterior = passados[0] || null;

  const semana = semanaAtual(plan, hoje);
  const fase = faseDaSemana(fases, semana);
  const progresso = progressoSemana(planned, semana);
  const streak = calcularStreak(planned, semana);

  return {
    hoje: treinoHoje,
    proximo,
    anterior,
    diasParaProximo: proximo ? diffDias(hoje, proximo.dataPlanejada) : null,
    semana,
    fase,
    progresso,
    streak,
  };
}

/** Progresso de uma semana: sessões feitas/total e minutos feitos/total. */
export function progressoSemana(planned, semana) {
  const daSemana = planned.filter((w) => w.semana === semana);
  const feitos = daSemana.filter((w) => w.status === "concluido");
  const soma = (arr) => arr.reduce((a, w) => a + (w.duracaoMin || 0), 0);
  return {
    feitos: feitos.length,
    total: daSemana.length,
    minFeitos: soma(feitos),
    minTotal: soma(daSemana),
  };
}

/**
 * Streak = semanas consecutivas com >= 2 sessões concluídas, contando para trás
 * a partir da semana atual. A semana atual, se ainda tiver < 2, não quebra a
 * sequência (está em andamento).
 */
export function calcularStreak(planned, semanaAtualNum, minSessoes = 2) {
  const concluidosPorSemana = {};
  for (const w of planned) {
    if (w.status === "concluido") concluidosPorSemana[w.semana] = (concluidosPorSemana[w.semana] || 0) + 1;
  }
  let streak = 0;
  for (let s = semanaAtualNum; s >= 1; s--) {
    const feitos = concluidosPorSemana[s] || 0;
    if (feitos >= minSessoes) streak++;
    else if (s === semanaAtualNum) continue; // semana atual em andamento não quebra
    else break;
  }
  return streak;
}
