// nutricao.js — plano alimentar (consulta) e registro diário. Sem DOM.
//
// O plano vem literal de data/plano-alimentar.js. As macros são ESTIMATIVAS por
// refeição e variante (tabela MACROS), não valores oficiais da nutricionista; a
// interface sempre diz isso.
//
// Definições (também na tela "Como calculamos"):
//   - proteína do dia: Σ macros.prot × fração das refeições + Σ proteína extra
//   - bateu a meta: proteína do dia ≥ mínimo configurado em Metas
//   - média semanal: só dos dias com algum registro; dias sem registro aparecem
//     à parte (esquecer de lançar não vira "dia de proteína baixa")

import * as repo from "../data/repository.js";
import { PLANO, MACROS, ROTULO_CURTO, ROTULO_HORA } from "../data/plano-alimentar.js";
import { obterMetas } from "./metas.js";
import { hoje as hojeISO, somarDias, inicioDaSemana } from "./dates.js";

export { PLANO, ROTULO_CURTO, ROTULO_HORA };

export const FRACOES = [
  { valor: 1, rotulo: "Tudo" },
  { valor: 0.75, rotulo: "¾" },
  { valor: 0.5, rotulo: "Metade" },
  { valor: 0.25, rotulo: "¼" },
];

const ZERO = { kcal: 0, prot: 0, carb: 0, gord: 0 };

// ---------------------------------------------------------------------------
// Consulta ao plano (puro)
// ---------------------------------------------------------------------------

/** Refeição escolhida pelo relógio (mesma regra do App_Dieta). */
export function refeicaoDoHorario(hora) {
  if (hora < 10) return "cafe";
  if (hora < 15) return "almoco";
  if (hora < 19) return "lanche";
  return "jantar";
}

export function refeicoes() {
  return PLANO.refeicoes;
}
export function obterRefeicao(id) {
  return PLANO.refeicoes.find((r) => r.id === id) || null;
}
export function nomeVariante(refeicao, i) {
  const v = refeicao.variantes[i];
  if (!v) return null;
  return v.nome || (refeicao.variantes.length > 1 ? `Opção ${i + 1}` : null);
}
export function macrosEstimados(refeicaoId, varianteIndex = 0) {
  const lista = MACROS[refeicaoId] || [];
  return { ...(lista[varianteIndex] || lista[0] || ZERO) };
}

/** Sem acento, sem caixa — para comparar termo de busca com os dados. */
export function normaliza(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** "GRUPO DOS PÃES – 1 porção" -> {titulo, nota}. */
export function partesDoGrupo(nome) {
  const corte = /\s[–—-]\s/.exec(nome);
  if (!corte) return { titulo: nome, nota: null };
  return { titulo: nome.slice(0, corte.index).trim(), nota: nome.slice(corte.index + corte[0].length).trim() };
}

/** Grupos de substituição que casam por nome do grupo ou do alimento. */
export function procurarSubstituicoes(termo) {
  const alvo = normaliza(termo);
  if (!alvo) return [];
  const subs = PLANO.substituicoes || {};
  const achados = [];
  for (const grupo of Object.keys(subs)) {
    const itens = subs[grupo] || [];
    const casaGrupo = normaliza(grupo).includes(alvo);
    const casados = [];
    itens.forEach((item, i) => { if (normaliza(item.alimento).includes(alvo)) casados.push(i); });
    if (casaGrupo || casados.length) {
      achados.push({ grupo, itens, casados, nota: (PLANO.notasSubstituicoes || {})[grupo] || null });
    }
  }
  return achados;
}

/**
 * Montar prato (puro). `escolhas` mapeia o nome do grupo do bloco para a opção
 * escolhida. Blocos obrigatórios sem escolha viram pendências (avisam, não travam).
 */
export function resumoDoPrato(refeicaoId, varianteIndex, escolhas) {
  const ref = obterRefeicao(refeicaoId);
  const blocos = (ref && ref.variantes[varianteIndex] && ref.variantes[varianteIndex].blocos) || [];
  const itens = [];
  const pendentes = [];
  for (const bloco of blocos) {
    const op = escolhas[bloco.grupo];
    if (op) itens.push({ grupo: bloco.grupo, alimento: op.alimento, quantidade: op.quantidade || null });
    else if (bloco.obrigatorio !== false) pendentes.push(bloco.grupo);
  }
  return { itens, pendentes, total: blocos.length };
}

// ---------------------------------------------------------------------------
// Somas (puro)
// ---------------------------------------------------------------------------

const arred1 = (n) => Math.round(n * 10) / 10;

/** Totais de um conjunto de registros (normalmente os de um dia). */
export function totaisDoDia(registros) {
  const t = { proteina: 0, kcal: 0, carb: 0, gord: 0, proteinaRefeicoes: 0, proteinaExtra: 0 };
  for (const r of registros) {
    if (r.removido) continue;
    if (r.tipo === "refeicao") {
      const f = r.fracao ?? 1;
      const m = r.macros || ZERO;
      t.proteinaRefeicoes += (m.prot || 0) * f;
      t.kcal += (m.kcal || 0) * f;
      t.carb += (m.carb || 0) * f;
      t.gord += (m.gord || 0) * f;
    } else if (r.tipo === "extra") {
      t.proteinaExtra += r.proteinaG || 0;
    }
  }
  t.proteina = arred1(t.proteinaRefeicoes + t.proteinaExtra);
  t.proteinaRefeicoes = arred1(t.proteinaRefeicoes);
  t.proteinaExtra = arred1(t.proteinaExtra);
  t.kcal = Math.round(t.kcal);
  t.carb = arred1(t.carb);
  t.gord = arred1(t.gord);
  return t;
}

/** Proteína de um dia (atalho de totaisDoDia). */
export function proteinaDoDia(registros) {
  return totaisDoDia(registros).proteina;
}

/**
 * Semana de proteína (puro). Dias futuros ficam de fora; dias sem nenhum
 * registro não entram na média nem contam como "não bateu".
 */
export function resumirSemanaProteina({ registros, inicio, metas, hoje = hojeISO() }) {
  const dias = [];
  for (let i = 0; i < 7; i++) {
    const data = somarDias(inicio, i);
    if (data > hoje) { dias.push({ data, futuro: true, proteina: null, bateu: false }); continue; }
    const doDia = registros.filter((r) => r.data === data && !r.removido);
    const proteina = doDia.length ? proteinaDoDia(doDia) : null;
    dias.push({ data, futuro: false, proteina, bateu: proteina != null && proteina >= metas.proteinaMinG });
  }
  const comRegistro = dias.filter((d) => d.proteina != null);
  const media = comRegistro.length ? Math.round(comRegistro.reduce((a, d) => a + d.proteina, 0) / comRegistro.length) : null;
  return {
    inicio, fim: somarDias(inicio, 6), dias,
    diasComRegistro: comRegistro.length,
    diasMeta: comRegistro.filter((d) => d.bateu).length,
    diasSemRegistro: dias.filter((d) => !d.futuro && d.proteina == null).length,
    media,
    metaMin: metas.proteinaMinG, metaMax: metas.proteinaMaxG,
  };
}

// ---------------------------------------------------------------------------
// Leitura (via repository)
// ---------------------------------------------------------------------------

/** Tudo de um dia: registros por refeição, extras e totais. */
export async function carregarDia(data = hojeISO()) {
  const [registros, metas] = await Promise.all([repo.listarRegistrosAlimentares({ de: data, ate: data }), obterMetas()]);
  const porRefeicao = {};
  for (const r of registros) if (r.tipo === "refeicao") porRefeicao[r.refeicaoId] = r;
  return {
    data, registros, porRefeicao,
    extras: registros.filter((r) => r.tipo === "extra"),
    totais: totaisDoDia(registros),
    metas,
  };
}

/** Últimas `n` semanas de proteína, a mais recente primeiro. */
export async function carregarSemanas(n = 4, hoje = hojeISO()) {
  const pds = await repo.obterConfig("primeiroDiaSemana", 1);
  const atual = inicioDaSemana(hoje, pds);
  const de = somarDias(atual, -7 * (n - 1));
  const [registros, metas] = await Promise.all([
    repo.listarRegistrosAlimentares({ de, ate: somarDias(atual, 6) }),
    obterMetas(),
  ]);
  const semanas = [];
  for (let k = 0; k < n; k++) {
    semanas.push(resumirSemanaProteina({ registros, inicio: somarDias(atual, -7 * k), metas, hoje }));
  }
  return semanas;
}

/** Variante usada da última vez nesta refeição (padrão do registro de 1 toque). */
export async function ultimaVariante(refeicaoId) {
  const todos = await repo.listarRegistrosAlimentares();
  const daRefeicao = todos.filter((r) => r.tipo === "refeicao" && r.refeicaoId === refeicaoId);
  if (!daRefeicao.length) return 0;
  daRefeicao.sort((a, b) => (a.atualizadoEm < b.atualizadoEm ? 1 : -1));
  return daRefeicao[0].varianteIndex || 0;
}

// ---------------------------------------------------------------------------
// Escritas (via repository)
// ---------------------------------------------------------------------------

/** Marca a refeição como feita. Mesma refeição no mesmo dia => edita. */
export async function registrarRefeicao({ data = hojeISO(), refeicaoId, varianteIndex, fracao = 1, escolhas }) {
  const ref = obterRefeicao(refeicaoId);
  if (!ref) throw new Error(`Refeição desconhecida: ${refeicaoId}`);
  const vi = varianteIndex ?? (await ultimaVariante(refeicaoId));
  return repo.registrarRefeicao({
    data, refeicaoId, fracao,
    varianteIndex: vi,
    varianteNome: nomeVariante(ref, vi),
    macros: macrosEstimados(refeicaoId, vi),
    escolhas: escolhas === undefined ? undefined : (escolhas && Object.keys(escolhas).length ? escolhas : null),
  });
}

export function registrarProteinaExtra({ data = hojeISO(), proteinaG, descricao }) {
  return repo.registrarExtra({ data, proteinaG, descricao: descricao || null });
}

export function desfazerRegistro(registro) {
  return repo.removerRegistroAlimentar(registro.id);
}
