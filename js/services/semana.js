// semana.js — liga o motor de rotas (puro) aos dados. Sem DOM. Lê o estado pelo
// repository, roda o motor, aplica a rota aceita, fecha a semana e grava o histórico.
//
// O status da semana só muda de "fora do plano" para "em dia" ao tocar em
// Recalcular. O `controle` (em settings) guarda o que foi visto por último, para
// isso continuar valendo depois de fechar o app:
//   - foraVista: a semana estava fora do plano na última leitura
//   - nao: treinos com ✕ já conhecidos
//   - pendente: mudou algo depois do último recálculo ("Registros atualizados")
//   - decididos: treinos com ✕ de uma rota aceita, que não voltam a ser oferecidos
//
// Ao aceitar uma rota, a semana é fotografada. "Desfazer" volta à foto enquanto os
// treinos da semana continuarem como a rota deixou.

import * as repo from "../data/repository.js";
import { DISPONIBILIDADE_PADRAO } from "../data/rotas-config.js";
import { carregarSemana, marcarSessao, moverEntrada, alternarCorridaNaoFeita, statusDaSessao, primeiroDiaSemana } from "./agenda.js";
import { juntar } from "./merge.js";
import { assinaturaDoEstado, avaliar, calcularOfertas, calcularRotas, montarEstado } from "./motor-rotas.js";
import { agoraISO, inicioDaSemana, paraISODate, somarDias } from "./dates.js";
import { corridaFeita } from "./dominio.js";

const CHAVE_CONTROLE = "semanaControle";
const CHAVE_DISPONIBILIDADE = "disponibilidade";
const CHAVE_DESFAZER = "semanaDesfazer";
const CHECKIN_VAZIO = { disposicao: 3, dorUpper: false, dorLower: false, fascia: false };

// ---------------------------------------------------------------------------
// Semana-padrão
// ---------------------------------------------------------------------------

export async function obterDisponibilidade() {
  return { ...DISPONIBILIDADE_PADRAO, ...(await repo.obterConfig(CHAVE_DISPONIBILIDADE, {})) };
}
export function salvarDisponibilidade(grade) {
  return repo.definirConfig(CHAVE_DISPONIBILIDADE, grade);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

async function lerControle(inicio) {
  const c = await repo.obterConfig(CHAVE_CONTROLE, null);
  return c && c.inicio === inicio ? c : null;
}
const idsComX = (estado) => estado.sessoes.filter((s) => s.status === "nao_feito").map((s) => s.id);

async function carregarEstado(agora) {
  const hoje = paraISODate(agora);
  const semana = await carregarSemana(hoje);
  const [disponibilidade, excecoes, checkin, controle] = await Promise.all([
    obterDisponibilidade(),
    repo.listarExcecoes({ de: semana.inicio, ate: semana.fim }),
    repo.obterCheckin(hoje),
    lerControle(semana.inicio),
  ]);
  const estado = montarEstado({ semana, agora, disponibilidade, excecoes, checkin, decididos: controle ? controle.decididos : [] });
  return { estado, semana, controle, excecoes, checkin };
}

/**
 * Situação da semana atual para as telas. Atualiza o controle: a semana só deixa
 * de estar "fora do plano" depois de Recalcular; um ✕ novo também pede recálculo.
 */
export async function situacaoSemana(agora = new Date()) {
  await prepararSemana(agora);
  const dados = await carregarEstado(agora);
  const avaliacao = avaliar(dados.estado);
  const nao = idsComX(dados.estado);
  const antes = dados.controle || { inicio: dados.semana.inicio, foraVista: avaliacao.fora, nao, pendente: false, decididos: [] };
  const decididos = antes.decididos.filter((id) => nao.includes(id));
  const xNovo = nao.some((id) => !antes.nao.includes(id) && !decididos.includes(id));
  const pendente = antes.pendente || (antes.foraVista && !avaliacao.fora) || xNovo;
  const controle = { ...antes, foraVista: avaliacao.fora, nao, pendente, decididos };
  if (!dados.controle || JSON.stringify(controle) !== JSON.stringify(dados.controle)) {
    await repo.definirConfig(CHAVE_CONTROLE, controle);
  }
  return {
    ...dados, controle, avaliacao, pendente,
    aviso: avaliacao.fora || pendente,
    assinatura: assinaturaDoEstado(dados.estado),
  };
}

/** Atualiza o controle sem pedir recálculo (check-in e exceções não são registros de treino). */
async function aceitarEstadoAtual(agora) {
  const { estado, semana, controle } = await carregarEstado(agora);
  const nao = idsComX(estado);
  const base = controle || { inicio: semana.inicio, pendente: false, decididos: [] };
  return repo.definirConfig(CHAVE_CONTROLE, { ...base, foraVista: avaliar(estado).fora, nao });
}

// ---------------------------------------------------------------------------
// Recalcular
// ---------------------------------------------------------------------------

/**
 * O botão "Recalcular semana de treinos". Semana fora do plano: busca as rotas.
 * Em dia: oferece alternativas (check-in de hoje, treinos com ✕). Devolve
 * {assinatura, tipo: 'rotas'|'comprometida'|'ofertas'|'em_dia', ...}.
 */
export async function recalcular(agora = new Date()) {
  const { estado, semana, controle, avaliacao, assinatura } = await situacaoSemana(agora);
  await repo.definirConfig(CHAVE_CONTROLE, { ...controle, inicio: semana.inicio, foraVista: avaliacao.fora, nao: idsComX(estado), pendente: false });
  if (avaliacao.fora) return { assinatura, ...calcularRotas(estado) };
  const ofertas = calcularOfertas(estado);
  return { assinatura, tipo: ofertas.temOferta ? "ofertas" : "em_dia", ...ofertas };
}

// ---------------------------------------------------------------------------
// Aceitar
// ---------------------------------------------------------------------------

function acharEntrada(semana, id) {
  const [tipo, ...resto] = id.split(":");
  const chave = resto.join(":");
  for (const dia of semana.dias) {
    for (const e of dia.entradas) {
      if (tipo === "item" && e.tipo === "sessao" && e.item.id === chave) return { entrada: e, data: dia.data };
      if (tipo === "run" && e.tipo === "corrida" && e.planned.id === chave) return { entrada: e, data: dia.data };
      if (tipo === "merge" && e.tipo === "mesclada" && e.merge.id === chave) return { entrada: e, data: dia.data };
    }
  }
  throw new Error("Este treino mudou. Recalcule a semana.");
}

async function marcarNaoFeito(semana, id) {
  const { entrada, data } = acharEntrada(semana, id);
  if (entrada.tipo === "sessao") return marcarSessao(entrada.item, data, "nao_feito");
  if (entrada.tipo === "corrida") return repo.marcarStatusPlanned(entrada.planned.id, "nao_realizado");
  return repo.atualizarMerge(entrada.merge.id, { status: "nao_feito" });
}

/** Tira o ✕ antes de mover: o treino volta a ficar pendente. */
async function reabrir(semana, id) {
  const { entrada } = acharEntrada(semana, id);
  if (entrada.tipo === "sessao" && entrada.log) await repo.removerSessao(entrada.log.id);
  if (entrada.tipo === "corrida" && entrada.planned.status === "nao_realizado") await alternarCorridaNaoFeita(entrada.planned);
}

const ORDEM_DE_APLICAR = { naoFazer: 0, mover: 1, juntar: 2, encurtar: 3 };

async function aplicarOperacao(op, dataRef) {
  let semana = await carregarSemana(dataRef);
  if (op.tipo === "naoFazer") return marcarNaoFeito(semana, op.id);
  if (op.tipo === "encurtar") return repo.editarPlanned(acharEntrada(semana, op.id).entrada.planned.id, { encurtada: true });
  if (op.tipo === "mover") {
    if (op.reabrir) { await reabrir(semana, op.id); semana = await carregarSemana(dataRef); }
    const { entrada, data } = acharEntrada(semana, op.id);
    return moverEntrada(entrada, data, { data: op.data, periodo: op.periodo, ordem: 0 });
  }
  return juntar({ escolhidas: op.ids.map((id) => acharEntrada(semana, id)), data: op.data, periodo: op.periodo });
}

/** Aplica a rota usando as funções que já existem. Nada muda sem o usuário tocar em Aceitar. */
export async function aceitarRota(rota, agora = new Date()) {
  const hoje = paraISODate(agora);
  const ops = [...rota.ops].sort((a, b) => ORDEM_DE_APLICAR[a.tipo] - ORDEM_DE_APLICAR[b.tipo]);
  const faixa = await faixaDaSemana(hoje);
  const fotoAntes = await repo.fotografarSemana(faixa);
  const controleAntes = await lerControle(faixa.de);
  try {
    for (const op of ops) await aplicarOperacao(op, hoje);
    const semana = await carregarSemana(hoje);
    for (const { id } of rota.fechar || []) await marcarNaoFeito(semana, id);
  } finally {
    // Mesmo com falha no meio, o que foi aplicado fica; o resto aparece ao recalcular.
    const { estado, semana } = await carregarEstado(agora);
    const nao = idsComX(estado);
    await repo.definirConfig(CHAVE_CONTROLE, { inicio: semana.inicio, foraVista: avaliar(estado).fora, nao, pendente: false, decididos: nao });
    await repo.definirConfig(CHAVE_DESFAZER, {
      inicio: faixa.de, foto: fotoAntes, controle: controleAntes, mudancas: rota.mudancas,
      depois: impressaoDaFoto(await repo.fotografarSemana(faixa)),
    });
  }
  await registrarEscolha(hoje, { tipo: "rota", mudancas: rota.mudancas, custo: rota.custo, fechar: (rota.fechar || []).map((f) => f.id) });
}

async function faixaDaSemana(hoje) {
  const inicio = inicioDaSemana(hoje, await primeiroDiaSemana());
  return { de: inicio, ate: somarDias(inicio, 6) };
}

/** Muda quando qualquer treino da semana muda (marcar, mover, juntar…). */
const impressaoDaFoto = (foto) => Object.values(foto).flat().map((r) => `${r.id}@${r.atualizadoEm}`).sort().join("|");

/** A rota que ainda dá para desfazer, ou null se a semana mudou depois de aceitar. */
export async function rotaParaDesfazer(agora = new Date()) {
  const faixa = await faixaDaSemana(paraISODate(agora));
  const guardada = await repo.obterConfig(CHAVE_DESFAZER, null);
  if (!guardada || guardada.inicio !== faixa.de) return null;
  return impressaoDaFoto(await repo.fotografarSemana(faixa)) === guardada.depois ? guardada : null;
}

/** Volta a semana a como estava antes de aceitar a rota. O histórico registra as duas coisas. */
export async function desfazerRota(agora = new Date()) {
  const guardada = await rotaParaDesfazer(agora);
  if (!guardada) throw new Error("A semana mudou depois de aceitar a rota.");
  const faixa = await faixaDaSemana(paraISODate(agora));
  await repo.restaurarSemana(guardada.foto, faixa);
  await repo.definirConfig(CHAVE_CONTROLE, guardada.controle);
  await repo.definirConfig(CHAVE_DESFAZER, null);
  await registrarEscolha(paraISODate(agora), { tipo: "desfeita", mudancas: guardada.mudancas, custo: 0 });
}

/** "Manter como está": nada muda, mas a escolha fica no histórico. */
export function manterComoEsta(agora = new Date()) {
  return registrarEscolha(paraISODate(agora), { tipo: "manter", mudancas: [], custo: 0 });
}

// ---------------------------------------------------------------------------
// Check-in e exceções
// ---------------------------------------------------------------------------

export async function salvarCheckinDeHoje(dados, agora = new Date()) {
  await repo.salvarCheckin({ ...CHECKIN_VAZIO, ...dados, data: paraISODate(agora) });
  await aceitarEstadoAtual(agora);
}

export async function definirExcecao(data, excecao, agora = new Date()) {
  await repo.salvarExcecao({ data, ...excecao });
  await aceitarEstadoAtual(agora);
}

// ---------------------------------------------------------------------------
// Fechamento e histórico
// ---------------------------------------------------------------------------

async function planoOriginal(semana) {
  const agenda = await repo.listarAgenda();
  const itens = agenda.filter((i) => i.tipo !== "corrida").map((i) => ({
    scheduleItemId: i.id, data: somarDias(semana.inicio, (i.diaSemana + 6) % 7), periodo: i.periodo, tipo: i.tipo, rotulo: i.rotulo, opcional: !!i.opcional,
  }));
  const corridas = semana.dias.flatMap((d) => d.entradas.filter((e) => e.tipo === "corrida")).map((e) => ({
    plannedWorkoutId: e.planned.id, data: e.planned.dataOriginal || e.planned.dataPlanejada, periodo: e.periodo, tipo: "corrida", rotulo: e.planned.titulo,
  }));
  return [...itens, ...corridas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

function resultadoDaSemana(semana) {
  const corridas = semana.dias.flatMap((d) => d.entradas.filter((e) => e.tipo === "corrida"));
  return {
    previstos: semana.previstos, feitos: semana.feitos, naoFeitos: semana.naoFeitos, extras: semana.extras, lower: semana.lower,
    corridasEncurtadas: corridas.filter((e) => e.planned.status === "encurtado").length,
  };
}

/** Domingo às 23h59: o pendente vira "não feito" (só a aula opcional fica de fora). */
async function fecharSemana(registro) {
  const semana = await carregarSemana(registro.inicio);
  for (const dia of semana.dias) {
    for (const e of dia.entradas) {
      if (e.tipo === "sessao" && !e.item.opcional && !e.remanejado && !statusDaSessao(e)) await marcarSessao(e.item, dia.data, "nao_feito");
      if (e.tipo === "corrida" && !corridaFeita(e.planned.status) && e.planned.status !== "nao_realizado") await repo.marcarStatusPlanned(e.planned.id, "nao_realizado");
      if (e.tipo === "mesclada" && !e.merge.status) await repo.atualizarMerge(e.merge.id, { status: "nao_feito" });
    }
  }
  await repo.salvarHistoricoSemana({ ...registro, resultado: resultadoDaSemana(await carregarSemana(registro.inicio)), fechadaEm: agoraISO() });
}

/**
 * Sem servidor, a semana fecha na primeira abertura depois de domingo. Também
 * guarda o plano original da semana atual, a partir da primeira vez que ela é vista.
 */
export async function prepararSemana(agora = new Date()) {
  const inicio = inicioDaSemana(paraISODate(agora), await primeiroDiaSemana());
  const historicos = await repo.listarHistoricosSemana();
  for (const registro of historicos) {
    if (registro.inicio < inicio && !registro.fechadaEm) await fecharSemana(registro);
  }
  if (!historicos.some((r) => r.inicio === inicio)) {
    const semana = await carregarSemana(paraISODate(agora));
    await repo.salvarHistoricoSemana({ inicio, planoOriginal: await planoOriginal(semana), escolhas: [], resultado: null, fechadaEm: null });
  }
}

async function registrarEscolha(hoje, escolha) {
  const inicio = inicioDaSemana(hoje, await primeiroDiaSemana());
  const registro = await repo.obterHistoricoSemana(inicio);
  if (!registro) return;
  await repo.salvarHistoricoSemana({ ...registro, escolhas: [...(registro.escolhas || []), { em: agoraISO(), ...escolha }] });
}

/** Semana fechada continua editável: o resultado acompanha a marcação retroativa. */
export async function atualizarResultadoSemana(inicio) {
  const registro = await repo.obterHistoricoSemana(inicio);
  if (!registro || !registro.fechadaEm) return;
  const resultado = resultadoDaSemana(await carregarSemana(inicio));
  if (JSON.stringify(resultado) !== JSON.stringify(registro.resultado)) await repo.salvarHistoricoSemana({ ...registro, resultado });
}
