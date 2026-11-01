// merge.js — juntar duas sessões de musculação da semana numa só. Sem DOM.
//
// O merge acontece quando a semana desanda: duas sessões pendentes viram uma
// sessão combinada num dia da mesma semana, e o resto da semana é reorganizado.
// A sugestão de exercícios vem de data/sessoes-musculacao.js (configuração
// editável); aqui só há regras.
//
// Regras (também na tela "Como calculamos"):
//   - só musculação; duas sessões diferentes, da mesma semana, nenhuma feita
//     nem já mesclada; a combinada cai num dia dessa mesma semana
//   - Upper + Lower é permitido, com aviso de full body longo
//   - sugestão: une os itens das duas, um por slot (uma flexora e uma panturrilha
//     só), compostos antes de isoladores, acessórios por último, bi-sets; se passar
//     do teto de séries ou da duração-alvo, corta acessórios primeiro e depois
//     séries de isoladores
//   - dia seguinte com corrida ou karatê intenso: aviso de deixar reps na reserva
//   - desfazer só enquanto a combinada não foi feita

import * as repo from "../data/repository.js";
import { SESSOES, BISETS, LIMITES, META_SEMANAL, GRUPOS } from "../data/sessoes-musculacao.js";
import { carregarSemana, carregarDia, ehLower, ehUpper, statusDaSessao, moverEntrada } from "./agenda.js";
import { somarDias, hoje as hojeISO } from "./dates.js";

export const CONFIG_PADRAO = { SESSOES, BISETS, LIMITES, META_SEMANAL, GRUPOS };

export const AVISO_DIA_SEGUINTE = "Deixe 2 a 3 repetições na reserva, sem dropset e sem falha.";
export const AVISO_FULL_BODY = "Upper + Lower vira um full body longo.";

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ORDEM_PAPEL = { composto: 0, isolador: 1, acessorio: 2 };

/** Configuração da sessão pelo rótulo da agenda (sem acento, sem caixa). */
export function configDaSessao(rotulo, config = CONFIG_PADRAO) {
  const chave = Object.keys(config.SESSOES).find((k) => norm(k) === norm(rotulo));
  return chave ? config.SESSOES[chave] : null;
}

// ---------------------------------------------------------------------------
// Sugestão da sessão combinada (puro)
// ---------------------------------------------------------------------------

function minutosDe(itens, config) {
  const { minutosPorSerie, aquecimentoMin } = config.LIMITES;
  const t = (it) => it.series * (minutosPorSerie[it.papel] || 2);
  const porSlot = new Map(itens.map((it) => [it.slot, it]));
  const emBiset = new Set();
  let total = aquecimentoMin;
  for (const [a, b] of config.BISETS) {
    if (porSlot.has(a) && porSlot.has(b)) {
      total += Math.max(t(porSlot.get(a)), t(porSlot.get(b))); // bi-set: tempo de um só
      emBiset.add(a); emBiset.add(b);
    }
  }
  for (const it of itens) if (!emBiset.has(it.slot)) total += t(it);
  return Math.round(total);
}

const somaSeries = (itens) => itens.reduce((a, it) => a + it.series, 0);

/**
 * Monta a sugestão a partir dos rótulos das duas sessões. Devolve:
 *   itens    [{nome, slot, grupo, papel, series, origens, bisetCom}] na ordem de execução
 *   cortes   o que saiu para caber, na ordem em que foi cortado
 *   series, minutos, volume [{grupo, nome, series, meta}], semConfig [rótulos sem configuração]
 *   excede   ainda passa do teto/alvo depois de todos os cortes possíveis
 */
export function montarSugestao(rotulos, config = CONFIG_PADRAO) {
  const { tetoSeries, alvoMin } = config.LIMITES;
  const porSlot = new Map();
  const semConfig = [];
  let pos = 0;
  for (const rotulo of rotulos) {
    const cfg = configDaSessao(rotulo, config);
    if (!cfg) { semConfig.push(rotulo); continue; }
    for (const [lista, opcional] of [[cfg.obrigatorios || [], false], [cfg.acessorios || [], true]]) {
      for (const it of lista) {
        const atual = porSlot.get(it.slot);
        if (atual) {
          // duplicado entre as sessões: fica um só, com o maior número de séries
          atual.series = Math.max(atual.series, it.series);
          if (!atual.origens.includes(rotulo)) atual.origens.push(rotulo);
          if (!opcional) atual.opcional = false;
        } else {
          porSlot.set(it.slot, { ...it, papel: opcional ? "acessorio" : it.papel, opcional, origens: [rotulo], pos: pos++ });
        }
      }
    }
  }

  let itens = [...porSlot.values()].sort((a, b) => ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.pos - b.pos);

  // bi-set: o par fica junto, na posição do primeiro
  for (const [a, b] of config.BISETS) {
    const ia = itens.findIndex((it) => it.slot === a);
    const ib = itens.findIndex((it) => it.slot === b);
    if (ia < 0 || ib < 0) continue;
    itens[ia].bisetCom = itens[ib].nome;
    itens[ib].bisetCom = itens[ia].nome;
    const [par] = itens.splice(ib, 1);
    itens.splice(itens.findIndex((it) => it.slot === a) + 1, 0, par);
  }

  const cortes = [];
  const passa = () => somaSeries(itens) > tetoSeries || minutosDe(itens, config) > alvoMin[1];
  while (passa()) {
    const acessorios = itens.filter((it) => it.papel === "acessorio");
    if (acessorios.length) {
      const sai = acessorios[acessorios.length - 1];
      itens = itens.filter((it) => it !== sai);
      cortes.push({ tipo: "item", nome: sai.nome, series: sai.series });
      continue;
    }
    const isoladores = itens.filter((it) => it.papel === "isolador" && it.series > 2);
    if (!isoladores.length) break;
    const alvo = isoladores.reduce((m, it) => (it.series >= m.series ? it : m));
    alvo.series--;
    cortes.push({ tipo: "serie", nome: alvo.nome, series: 1 });
  }

  const volume = new Map();
  for (const it of itens) volume.set(it.grupo, (volume.get(it.grupo) || 0) + it.series);
  const grupos = [...new Set([...Object.keys(config.META_SEMANAL).filter((g) => volume.has(g)), ...volume.keys()])];
  return {
    itens: itens.map(({ pos: _p, ...it }) => it),
    cortes,
    series: somaSeries(itens),
    minutos: minutosDe(itens, config),
    teto: tetoSeries, alvoMin,
    volume: grupos.map((g) => ({ grupo: g, nome: config.GRUPOS[g] || g, series: volume.get(g), meta: config.META_SEMANAL[g] ?? null })),
    semConfig,
    excede: passa(),
  };
}

// ---------------------------------------------------------------------------
// Validação (pura)
// ---------------------------------------------------------------------------

/** A entrada (de montarDia) é uma sessão de musculação que ainda pode ser juntada? */
export function podeJuntar(entrada) {
  if (!entrada || entrada.tipo !== "sessao" || entrada.item.tipo !== "musculacao") return false;
  if (entrada.log && entrada.log.status === "mesclada") return false;
  return statusDaSessao(entrada) !== "feito";
}

/**
 * Valida o merge. `escolhidas` = [{entrada, data}] (data = dia em que a
 * ocorrência aparece na semana). Devolve {erros, avisos}; sem erros => pode juntar.
 */
export function validarMerge({ escolhidas, data, inicio }) {
  const erros = [];
  const avisos = [];
  const fim = somarDias(inicio, 6);
  const naSemana = (d) => d >= inicio && d <= fim;
  if (escolhidas.length !== 2) erros.push("Escolha duas sessões.");
  for (const { entrada, data: d } of escolhidas) {
    if (!entrada || entrada.tipo !== "sessao") { erros.push("Só sessões da agenda podem ser juntadas."); continue; }
    const rot = entrada.item.rotulo || "Sessão";
    if (entrada.item.tipo !== "musculacao") erros.push(`${rot}: corrida e karatê não entram em merge.`);
    else if (entrada.log && entrada.log.status === "mesclada") erros.push(`${rot} já está numa sessão combinada.`);
    else if (statusDaSessao(entrada) === "feito") erros.push(`${rot} já foi feita.`);
    if (!naSemana(d)) erros.push(`${rot} é de outra semana.`);
  }
  if (escolhidas.length === 2 && escolhidas[0].entrada && escolhidas[1].entrada &&
      escolhidas[0].entrada.item && escolhidas[1].entrada.item &&
      escolhidas[0].entrada.item.id === escolhidas[1].entrada.item.id) {
    erros.push("Escolha duas sessões diferentes.");
  }
  if (!data || !naSemana(data)) erros.push("A sessão combinada precisa cair na mesma semana.");
  const rotulos = escolhidas.map((e) => e.entrada && e.entrada.item ? e.entrada.item.rotulo : "");
  if (rotulos.some(ehLower) && rotulos.some(ehUpper)) avisos.push(AVISO_FULL_BODY);
  return { erros, avisos };
}

/** Corrida ou karatê intenso entre as entradas do dia seguinte? */
export function diaSeguintePesado(entradas) {
  return entradas.some((e) => {
    if (e.tipo === "corrida") return true;
    const tipo = e.item ? e.item.tipo : e.log ? e.log.tipo : null;
    const rotulo = e.item ? e.item.rotulo : e.log ? e.log.rotulo : "";
    return tipo === "karate" && /intens/i.test(norm(rotulo));
  });
}

// ---------------------------------------------------------------------------
// Reorganizar o resto da semana (puro)
// ---------------------------------------------------------------------------

const ehMusculacao = (e) =>
  (e.tipo === "sessao" && e.item.tipo === "musculacao" && !(e.log && e.log.status === "mesclada")) ||
  (e.tipo === "avulsa" && e.log.tipo === "musculacao") ||
  e.tipo === "mesclada";

/**
 * Sessões de musculação que ficaram para trás (dia anterior a `hoje`, sem
 * registro de feito, não mescladas) e um dia livre de musculação, de hoje em
 * diante, para cada uma. Devolve [{entrada, data, destino}] (destino null = sem dia livre).
 */
export function sugerirReorganizacao(semana, hoje = hojeISO()) {
  const livres = semana.dias
    .filter((d) => d.data >= hoje && !d.entradas.some(ehMusculacao))
    .map((d) => d.data);
  const sugestoes = [];
  for (const dia of semana.dias) {
    if (dia.data >= hoje) continue;
    for (const e of dia.entradas) {
      if (!podeJuntar(e) || e.item.opcional || statusDaSessao(e) === "pulado") continue;
      sugestoes.push({ entrada: e, data: dia.data, destino: livres.shift() || null });
    }
  }
  return sugestoes;
}

// ---------------------------------------------------------------------------
// Leitura e escritas (via repository)
// ---------------------------------------------------------------------------

/** Sessões da semana que ainda podem ser juntadas: [{entrada, data}]. */
export function pendentesDaSemana(semana) {
  const r = [];
  for (const dia of semana.dias) for (const e of dia.entradas) if (podeJuntar(e)) r.push({ entrada: e, data: dia.data });
  return r;
}

/** Atrasadas = pendentes de dias anteriores a hoje (para o botão na tela Hoje). */
export function atrasadasDaSemana(semana, hoje = hojeISO()) {
  return pendentesDaSemana(semana).filter((p) => p.data < hoje && statusDaSessao(p.entrada) !== "pulado");
}

/** Aviso do dia seguinte à data da combinada (lê o dia, que pode ser da semana seguinte). */
export async function avisoDiaSeguinte(data) {
  return diaSeguintePesado(await carregarDia(somarDias(data, 1))) ? AVISO_DIA_SEGUINTE : null;
}

/** Junta as duas sessões escolhidas em `data`/`periodo`. Valida contra a semana atual do banco. */
export async function juntar({ escolhidas, data, periodo = "manha" }) {
  const semana = await carregarSemana(data);
  const { erros } = validarMerge({ escolhidas, data, inicio: semana.inicio });
  if (erros.length) throw new Error(erros.join(" "));
  const ordenadas = [...escolhidas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const rotulos = ordenadas.map((e) => e.entrada.item.rotulo);
  const origens = ordenadas.map(({ entrada, data: d }) => ({
    scheduleItemId: entrada.item.id, dataOcorrencia: d,
    dataOrigem: entrada.movimento ? entrada.movimento.dataOrigem : d,
    tipo: entrada.item.tipo, rotulo: entrada.item.rotulo, periodo: entrada.periodo, opcional: !!entrada.item.opcional,
  }));
  return repo.juntarSessoes({
    origens, data, periodo, ordem: -1, rotulo: rotulos.join(" + "), plano: montarSugestao(rotulos),
  });
}

export function desfazer(merge) {
  return repo.desfazerMerge(merge.id);
}

/** 1 toque na combinada: escolhe o status; tocar de novo no status ativo volta a pendente. */
export function alternarCombinada(merge, status) {
  return repo.atualizarMerge(merge.id, { status: merge.status === status ? null : status });
}

export function editarCombinada(merge, alteracoes) {
  return repo.atualizarMerge(merge.id, alteracoes);
}

/** Aplica uma sugestão de reorganização (mover a sessão para o dia livre, no período dela). */
export function aplicarReorganizacao({ entrada, data, destino }, ordem = 0) {
  return moverEntrada(entrada, data, { data: destino, periodo: entrada.periodo, ordem });
}
