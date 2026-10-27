// gravl.js — importação do CSV do Gravl, feita no aparelho. Sem DOM.
//
// O Gravl continua sendo o logger de musculação; aqui só lemos o export para:
//   1) marcar como feitas as sessões de musculação da agenda (casando por data);
//   2) contar séries semanais por grupo muscular (sem aquecimento);
//   3) mostrar a tendência de 1RM estimado (Epley) nos exercícios principais.
//
// Formato: uma linha por série. Colunas usadas: Date, Start Date, Workout,
// Source, Workout Duration (min), Exercise, Superset, Set, Set Type, Reps,
// Weight (kg), Distance (km), Set Duration (sec), Effort, Workout Notes.
// Reimportar o mesmo arquivo não duplica: cada treino tem uma `chave`
// (data + início + nome) e é atualizado no lugar.

import * as repo from "../data/repository.js";
import { GRUPOS, GRUPOS_PERNA, REGRAS } from "../data/grupos-musculares.js";
import { lerTabela } from "./csv.js";
import { paraISODate, diaDaSemana, inicioDaSemana, somarDias, hoje as hojeISO } from "./dates.js";
import { obterMetas } from "./metas.js";
import { snapshotItem, itemParaRemanejar, carregarSemanaCrua, primeiroDiaSemana } from "./agenda.js";

export { GRUPOS, GRUPOS_PERNA };

const OBRIGATORIAS = ["Date", "Workout", "Exercise", "Set Type", "Reps", "Weight (kg)"];
export const PRINCIPAIS_PADRAO = ["Leg Press", "Barbell Bench Press"];

const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Leitura de valores
// ---------------------------------------------------------------------------

/** Número com ponto ou vírgula decimal; vazio => null. */
export function numero(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Em datas a/b/aaaa: "dm" se algum a > 12, "md" se algum b > 12, senão null (ambíguo). */
export function detectarOrdemData(valores) {
  let dm = false, md = false;
  for (const v of valores) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(String(v).trim());
    if (!m) continue;
    if (Number(m[1]) > 12) dm = true;
    if (Number(m[2]) > 12) md = true;
  }
  if (dm && !md) return "dm";
  if (md && !dm) return "md";
  return null;
}

/**
 * Data de calendário LOCAL ('YYYY-MM-DD') a partir do texto do Gravl.
 * Aceita ISO ('2026-10-20', '2026-10-20 07:12', '2026-10-20T10:12:00Z'),
 * 'dd/mm/aaaa' ou 'mm/dd/aaaa' (conforme `ordem`) e, por último, o que o
 * navegador entender. Nunca passa 'YYYY-MM-DD' puro para new Date (bug UTC).
 */
export function lerData(v, ordem = "dm") {
  const s = String(v || "").trim();
  if (!s) return null;
  // ISO com fuso explícito: converte para o dia local
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : paraISODate(d);
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) {
    const [a, b] = [m[1], m[2]];
    const [dia, mes] = ordem === "md" ? [b, a] : [a, b];
    return `${m[3]}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : paraISODate(d);
}

// ---------------------------------------------------------------------------
// Classificação e contas (puro)
// ---------------------------------------------------------------------------

const REGRAS_RE = REGRAS.map((r) => ({
  grupo: r.grupo,
  res: r.termos.map((t) => new RegExp("(^|[^a-z0-9])" + escapar(norm(t)))),
}));

/** Grupo do exercício pela 1ª regra que casar (ver data/grupos-musculares.js). */
export function classificarExercicio(nome) {
  const n = norm(nome);
  for (const r of REGRAS_RE) if (r.res.some((re) => re.test(n))) return r.grupo;
  return "outro";
}

/** Série de trabalho = tudo que não é aquecimento (Normal, Dropset…). */
export function ehSerieDeTrabalho(s) {
  return !/^warm/.test(norm(s.tipoSerie).replace(/[^a-z]/g, ""));
}

/** 1RM estimado (Epley). 1 repetição => o próprio peso. */
export function epley(pesoKg, reps) {
  if (!(pesoKg > 0) || !(reps > 0)) return null;
  if (reps === 1) return pesoKg;
  return Math.round(pesoKg * (1 + reps / 30) * 10) / 10;
}

/** Séries de trabalho por grupo em [de, ate] + exercícios sem grupo. */
export function seriesPorGrupo(treinos, de, ate) {
  const cont = Object.fromEntries(Object.keys(GRUPOS).map((g) => [g, 0]));
  const semGrupo = new Set();
  for (const t of treinos) {
    if (t.removido || t.data < de || t.data > ate) continue;
    for (const s of t.series || []) {
      if (!ehSerieDeTrabalho(s)) continue;
      const g = classificarExercicio(s.exercicio);
      cont[g]++;
      if (g === "outro") semGrupo.add(s.exercicio);
    }
  }
  return { porGrupo: cont, semGrupo: [...semGrupo].sort() };
}

/** Treino é "de perna" se a maioria das séries de trabalho é de grupos de perna. */
export function ehTreinoDePerna(treino) {
  const trab = (treino.series || []).filter(ehSerieDeTrabalho);
  if (!trab.length) return false;
  const perna = trab.filter((s) => GRUPOS_PERNA.includes(classificarExercicio(s.exercicio))).length;
  return perna * 2 > trab.length;
}

/** Melhor 1RM estimado por treino para um exercício (nome sem acento/caixa). */
export function tendencia1RM(treinos, exercicio) {
  const alvo = norm(exercicio);
  const pontos = [];
  for (const t of [...treinos].sort((a, b) => (a.data < b.data ? -1 : 1))) {
    if (t.removido) continue;
    let melhor = null;
    for (const s of t.series || []) {
      if (norm(s.exercicio) !== alvo || !ehSerieDeTrabalho(s)) continue;
      const e = epley(s.pesoKg, s.reps);
      if (e != null && (melhor == null || e > melhor)) melhor = e;
    }
    if (melhor != null) pontos.push({ data: t.data, e1rm: melhor });
  }
  return pontos;
}

/** Exercícios distintos, do mais frequente para o menos. */
export function exerciciosPorFrequencia(treinos) {
  const n = new Map();
  for (const t of treinos) for (const s of t.series || []) n.set(s.exercicio, (n.get(s.exercicio) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
}

// ---------------------------------------------------------------------------
// CSV -> treinos (puro)
// ---------------------------------------------------------------------------

/**
 * @returns {{treinos:Array, avisos:string[], ordemData:'dm'|'md'|null, linhasIgnoradas:number}}
 */
export function interpretarCSV(texto) {
  const { cabecalho, linhas } = lerTabela(texto);
  const faltando = OBRIGATORIAS.filter((c) => !cabecalho.includes(c));
  if (faltando.length) {
    throw new Error(`Este arquivo não parece um export do Gravl: faltam as colunas ${faltando.join(", ")}.`);
  }
  const avisos = [];
  const detectada = detectarOrdemData(linhas.map((l) => l["Date"]));
  const ordem = detectada || "dm";
  if (!detectada && linhas.some((l) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(l["Date"]))) {
    avisos.push("As datas estão em dd/mm ou mm/dd e o arquivo não permite distinguir; foi usado dia/mês. Confira o período importado.");
  }

  const porChave = new Map();
  let ignoradas = 0;
  for (const l of linhas) {
    const data = lerData(l["Date"], ordem);
    if (!data || !l["Exercise"]) { ignoradas++; continue; }
    const inicio = l["Start Date"] || "";
    const nome = l["Workout"] || "Treino";
    const chave = `${data}|${inicio}|${nome}`;
    if (!porChave.has(chave)) {
      porChave.set(chave, {
        chave, data, inicio, nome,
        fonte: l["Source"] || null,
        duracaoMin: numero(l["Workout Duration (min)"]),
        energia: numero(l["Energy"]),
        notas: l["Workout Notes"] || null,
        series: [],
      });
    }
    porChave.get(chave).series.push({
      exercicio: l["Exercise"],
      superset: l["Superset"] || null,
      serie: numero(l["Set"]),
      tipoSerie: l["Set Type"] || "Normal",
      reps: numero(l["Reps"]),
      pesoKg: numero(l["Weight (kg)"]),
      distanciaKm: numero(l["Distance (km)"]),
      duracaoSeg: numero(l["Set Duration (sec)"]),
      inclinacao: numero(l["Incline"]),
      passos: numero(l["Steps"]),
      esforco: l["Effort"] || null,
    });
  }
  if (ignoradas) avisos.push(`${ignoradas} linha(s) sem data ou exercício foram ignoradas.`);
  const treinos = [...porChave.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return { treinos, avisos, ordemData: detectada, linhasIgnoradas: ignoradas };
}

// ---------------------------------------------------------------------------
// Importação (via repository)
// ---------------------------------------------------------------------------

/**
 * Casa um treino do Gravl com a agenda e grava/atualiza a sessão, sem duplicar:
 *   (a) item de musculação da mesma data: o de rótulo contido no nome; se o nome
 *       não cita rótulo nenhum da agenda (ex.: "Treino da manhã"), o do dia;
 *   (b) senão, item da mesma semana com o rótulo no nome do treino (remanejamento);
 *   (c) senão, sessão fora da agenda com rótulo "Lower" ou "Upper" pela maioria das séries.
 * Se já existe sessão ligada a este treino, só atualiza a duração.
 * @returns {'ja_ligado'|'data'|'semana'|'avulsa'}
 */
async function casarComAgenda(treino) {
  const { agenda, sessoesSemana } = await carregarSemanaCrua(treino.data);
  const ligada = sessoesSemana.find((s) => s.gravlWorkoutId === treino.id);
  if (ligada) {
    if (ligada.duracaoMin == null && treino.duracaoMin != null) await repo.atualizarSessao(ligada.id, { duracaoMin: Math.round(treino.duracaoMin) });
    return "ja_ligado";
  }
  const extras = { status: "feito", origem: "gravl", gravlWorkoutId: treino.id };
  const nomeN = norm(treino.nome);
  const doDia = agenda.filter((i) => i.tipo === "musculacao" && i.diaSemana === diaDaSemana(treino.data));
  const livre = (i) => !sessoesSemana.some((s) => s.scheduleItemId === i.id && s.data === treino.data && s.gravlWorkoutId);
  // Um treino cujo nome cita outro rótulo da agenda (ex.: "Lower A" numa
  // segunda de Upper A) não ocupa o item do dia: vai para o remanejamento.
  const citaRotulo = agenda.some((i) => i.tipo === "musculacao" && i.rotulo && nomeN.includes(norm(i.rotulo)));
  const itemDia = doDia.find((i) => livre(i) && i.rotulo && nomeN.includes(norm(i.rotulo)))
    || (citaRotulo ? null : doDia.find(livre));
  const duracao = treino.duracaoMin != null ? Math.round(treino.duracaoMin) : undefined;

  if (itemDia) {
    const existente = sessoesSemana.find((s) => s.scheduleItemId === itemDia.id && s.data === treino.data);
    await repo.registrarSessao({
      data: treino.data, scheduleItemId: itemDia.id, ...snapshotItem(itemDia), ...extras,
      duracaoMin: existente && existente.duracaoMin != null ? undefined : duracao,
    });
    return "data";
  }
  const itemSemana = itemParaRemanejar({ agenda, sessoesSemana, tipo: "musculacao", nomeLivre: treino.nome, data: treino.data });
  if (itemSemana) {
    await repo.registrarSessao({
      data: treino.data, scheduleItemId: itemSemana.id, ...snapshotItem(itemSemana), periodo: itemSemana.periodo, ...extras, duracaoMin: duracao,
    });
    return "semana";
  }
  await repo.registrarSessao({
    data: treino.data, scheduleItemId: null, tipo: "musculacao",
    rotulo: ehTreinoDePerna(treino) ? "Lower" : "Upper", periodo: "manha", opcional: false,
    ...extras, duracaoMin: duracao, observacoes: `Gravl: ${treino.nome}`,
  });
  return "avulsa";
}

/**
 * Importa o texto do CSV: grava os treinos (upsert por chave) e marca a agenda.
 * @returns relatório para a tela
 */
export async function importarCSV(texto) {
  const { treinos, avisos, ordemData } = interpretarCSV(texto);
  if (!treinos.length) throw new Error("Nenhum treino encontrado no arquivo.");
  const rel = await repo.importarTreinosGravl(treinos);
  const sessoes = { data: 0, semana: 0, avulsa: 0, ja_ligado: 0 };
  for (const t of rel.salvos) sessoes[await casarComAgenda(t)]++;
  const { semGrupo } = seriesPorGrupo(rel.salvos, "0000-00-00", "9999-99-99");
  return {
    novos: rel.novos, atualizados: rel.atualizados, iguais: rel.iguais,
    sessoes, avisos, ordemData, semGrupo,
    de: treinos[0].data, ate: treinos[treinos.length - 1].data,
    totalSeries: treinos.reduce((a, t) => a + t.series.length, 0),
  };
}

// ---------------------------------------------------------------------------
// Leitura para as telas
// ---------------------------------------------------------------------------

export async function exerciciosPrincipais() {
  return repo.obterConfig("gravlExerciciosPrincipais", PRINCIPAIS_PADRAO);
}
export function salvarExerciciosPrincipais(lista) {
  return repo.definirConfig("gravlExerciciosPrincipais", lista);
}

/** Séries da semana de `dataRef` contra as metas de perna, e 1RM dos principais. */
export async function carregarResumoGravl(dataRef = hojeISO()) {
  const [treinos, metas, principais, pds] = await Promise.all([
    repo.listarTreinosGravl(), obterMetas(), exerciciosPrincipais(), primeiroDiaSemana(),
  ]);
  const inicio = inicioDaSemana(dataRef, pds);
  const fim = somarDias(inicio, 6);
  const semana = seriesPorGrupo(treinos, inicio, fim);
  return {
    temDados: treinos.length > 0,
    inicio, fim,
    porGrupo: semana.porGrupo,
    semGrupo: semana.semGrupo,
    metas: metas.seriesPerna,
    treinosNaSemana: treinos.filter((t) => t.data >= inicio && t.data <= fim).length,
    principais,
    tendencias: principais.map((ex) => ({ exercicio: ex, pontos: tendencia1RM(treinos, ex) })),
    exercicios: exerciciosPorFrequencia(treinos),
    ultimo: treinos.length ? treinos[treinos.length - 1].data : null,
  };
}

