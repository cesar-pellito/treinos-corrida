// seed.js — carga inicial do plano (primeira execução).
//
// Lê data/plano-seed.json (templates T1–T6 + 22 semanas), pede a data de início e
// os dias de treino, calcula as datas dos treinos e grava plano + fases + os 66
// (ou 44, se 2 dias/semana) plannedWorkouts, tudo via repository.js.
//
// Camada de dados: usa repository (não fala com IndexedDB direto).

import * as repo from "./repository.js";
import { inicioDaSemana, somarDias } from "../services/dates.js";

const CAMINHO_SEED = new URL("../../data/plano-seed.json", import.meta.url);

/** Já existe um plano ativo? Então não semeia de novo. */
export async function jaSemeado() {
  return (await repo.planoAtivo()) != null;
}

/** Carrega o JSON do seed (no navegador). Em testes, passe o objeto direto. */
export async function carregarSeedJSON() {
  const resp = await fetch(CAMINHO_SEED);
  if (!resp.ok) throw new Error(`Falha ao carregar plano-seed.json: ${resp.status}`);
  return resp.json();
}

/**
 * Escolhe quais sessões da semana entram, conforme nº de dias de treino e fase.
 * Regra do plano: com 2 dias, corte a sessão B; nas fases 3 e 4 mantenha sempre
 * a rodagem longa (C) e a sessão de qualidade (B) — ou seja, corte a A.
 */
export function escolherSessoes(fase, nDias) {
  if (nDias >= 3) return ["A", "B", "C"];
  return fase >= 3 ? ["B", "C"] : ["A", "C"];
}

/**
 * Calcula a data de cada sessão. As sessões escolhidas da semana são atribuídas
 * aos dias de treino em ordem cronológica: a última (mais tarde na semana) fica
 * com a sessão C (rodagem longa).
 *
 * @param {object} seed  objeto do plano-seed.json
 * @param {{dataInicio:string, diasTreino:number[], primeiroDiaSemana?:number}} cfg
 * @returns {Array} lista de {semana, fase, sessao, dataPlanejada, template, absorcao, nota, volumeSemanaMin, rpeSemanaTexto}
 */
export function calcularDatasSessoes(seed, cfg) {
  const primeiroDiaSemana = cfg.primeiroDiaSemana ?? 1;
  const dias = [...cfg.diasTreino].sort((a, b) => a - b);
  if (dias.length < 2 || dias.length > 3) {
    throw new Error("Escolha 2 ou 3 dias de treino por semana.");
  }
  const anchor = inicioDaSemana(cfg.dataInicio, primeiroDiaSemana); // início da semana 1
  const offsetNaSemana = (weekday) => (weekday - primeiroDiaSemana + 7) % 7;

  const out = [];
  for (const semana of seed.semanas) {
    const baseSemana = somarDias(anchor, (semana.semana - 1) * 7);
    const sessoes = escolherSessoes(semana.fase, dias.length);
    // zip: sessões (ordem A,B,C) x dias ordenados -> C cai no dia mais tarde
    sessoes.forEach((sessaoKey, i) => {
      const weekday = dias[i];
      const dataPlanejada = somarDias(baseSemana, offsetNaSemana(weekday));
      out.push({
        semana: semana.semana,
        fase: semana.fase,
        sessao: sessaoKey,
        dataPlanejada,
        template: semana.sessoes[sessaoKey],
        absorcao: semana.absorcao,
        nota: semana.nota,
        volumeSemanaMin: semana.volumeSemanaMin,
        rpeSemanaTexto: semana.rpeSemanaTexto,
      });
    });
  }
  return out;
}

/** Constrói o objeto plannedWorkout a partir do template + modelo. */
function montarPlannedWorkout(seed, planId, phaseId, item) {
  const t = item.template;
  const modelo = seed.modelos[t.modelo];
  return {
    id: repo.gerarId(),
    planId,
    phaseId,
    semana: item.semana,
    sessao: item.sessao,
    dataPlanejada: item.dataPlanejada,
    dataOriginal: null,
    tipo: modelo.tipo,
    modelo: t.modelo,
    titulo: modelo.titulo,
    doseTexto: t.dose,
    objetivoFisiologico: modelo.objetivoFisiologico,
    descricao: t.dose,
    aquecimento: modelo.aquecimento,
    partePrincipal: t.partePrincipal,
    desaquecimento: modelo.desaquecimento,
    ritmo: modelo.ritmo || null,
    regraSeguranca: modelo.regraSeguranca || null,
    duracaoMin: t.duracaoMin,
    distanciaKm: null,
    rpeMin: t.rpeMin,
    rpeMax: t.rpeMax,
    zonaFC: t.zonaFC,
    volumeSemanaMin: item.volumeSemanaMin,
    rpeSemanaTexto: item.rpeSemanaTexto,
    semanaAbsorcao: item.absorcao,
    status: "futuro", // 'hoje' é derivado em runtime (data == hoje), não persistido
    sequence: 0, // contador do .ics (incrementa a cada reagendamento)
    observacoes: item.nota || null,
  };
}

/**
 * Semeia plano + fases + treinos. Idempotente por checagem de plano ativo.
 * @param {object} seed
 * @param {{dataInicio:string, diasTreino:number[], primeiroDiaSemana?:number, nomePlano?:string}} cfg
 */
export async function semearPlano(seed, cfg) {
  if (await jaSemeado()) return { jaExistia: true };

  const primeiroDiaSemana = cfg.primeiroDiaSemana ?? 1;
  const planId = repo.gerarId();
  await repo.salvarPlano(
    {
      id: planId,
      nome: cfg.nomePlano || seed.plano.nome,
      versao: seed.plano.versao,
      dataInicio: inicioDaSemana(cfg.dataInicio, primeiroDiaSemana),
      diasTreino: [...cfg.diasTreino].sort((a, b) => a - b),
      primeiroDiaSemana,
      totalSemanas: seed.plano.totalSemanas,
      sessoesPorSemana: seed.plano.sessoesPorSemana,
      fonte: seed.fonte,
      ativo: true,
    },
    { novo: true }
  );

  // Fases -> mapa fase.numero => phaseId
  const faseIdPorNumero = {};
  for (const f of seed.fases) {
    const phaseId = repo.gerarId();
    faseIdPorNumero[f.numero] = phaseId;
    await repo.salvarFase(
      {
        id: phaseId,
        planId,
        numero: f.numero,
        nome: f.nome,
        objetivo: f.objetivo,
        semanaInicio: f.semanaInicio,
        semanaFim: f.semanaFim,
        volumeAlvo: f.volumeAlvo,
        intensidade: f.intensidade,
        criterioAvanco: f.criterioAvanco,
      },
      { novo: true }
    );
  }

  // Treinos planejados
  const itens = calcularDatasSessoes(seed, cfg);
  for (const item of itens) {
    const w = montarPlannedWorkout(seed, planId, faseIdPorNumero[item.fase], item);
    await repo.salvarPlanned(w, { novo: true });
  }

  // Configurações padrão
  await repo.definirConfig("horarioLembrete", cfg.horarioLembrete || "20:00");
  await repo.definirConfig("unidadeDistancia", "km");
  await repo.definirConfig("primeiroDiaSemana", primeiroDiaSemana);
  await repo.definirConfig("temaEscuro", "auto");
  await repo.definirConfig("ultimoBackup", null);

  return { jaExistia: false, planId, treinos: itens.length, fases: seed.fases.length };
}

/** Orquestra a carga no app: só roda se ainda não houver plano. */
export async function executarSeedSeNecessario(cfg) {
  if (await jaSemeado()) return { jaExistia: true };
  const seed = await carregarSeedJSON();
  return semearPlano(seed, cfg);
}
