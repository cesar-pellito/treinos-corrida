// repository.js — fachada ÚNICA de persistência.
//
// Toda leitura/escrita de dados do app passa por aqui. A UI e os services NÃO
// falam com o IndexedDB (db.js) diretamente. É aqui que vivem as REGRAS DE
// INTEGRIDADE que são o coração do produto:
//   - IDs sempre com crypto.randomUUID()
//   - registrar um treino cria um completedWorkout e só altera o `status` do planejado
//   - histórico é append-only: alterar plano nunca reescreve/apaga realizados
//   - reagendar preenche dataOriginal uma única vez
//   - proibido dois completedWorkouts para o mesmo plannedWorkoutId
//   - import/merge por ID com last-write-wins por atualizadoEm, sem duplicar
//
// Campos de sync: toda escrita local carimba atualizadoEm e _pendingSync=true.
// A sincronização com Google Sheets (Etapa 7) limpa _pendingSync via marcarSincronizados.

import { STORES, comTransacao, req, abrirDB } from "./db.js";
import { agoraISO } from "../services/dates.js";

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------
export function gerarId() {
  return globalThis.crypto.randomUUID();
}

function chaveDe(store) {
  return store === STORES.settings ? "chave" : "id";
}

/** Carimba criadoEm (se novo), atualizadoEm e _pendingSync numa escrita local. */
function carimbar(registro, { novo }) {
  const agora = agoraISO();
  const r = { ...registro };
  if (novo && !r.criadoEm) r.criadoEm = agora;
  r.atualizadoEm = agora;
  r._pendingSync = true;
  return r;
}

function getReq(tx, store, key) {
  return req(tx.objectStore(store).get(key));
}
function getAllReq(tx, store) {
  return req(tx.objectStore(store).getAll());
}
function indexGetAll(tx, store, indexName, key) {
  return req(tx.objectStore(store).index(indexName).getAll(key));
}

// ---------------------------------------------------------------------------
// CRUD genérico (uso interno + casos simples)
// ---------------------------------------------------------------------------
async function put(store, registro, { novo }) {
  const carimbado = carimbar(registro, { novo });
  await comTransacao(store, "readwrite", (tx) => {
    tx.objectStore(store).put(carimbado);
  });
  return carimbado;
}
async function obter(store, key) {
  return comTransacao(store, "readonly", (tx) => getReq(tx, store, key));
}
async function listar(store) {
  return comTransacao(store, "readonly", (tx) => getAllReq(tx, store));
}

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------
export async function salvarPlano(plano, { novo = false } = {}) {
  if (!plano.id) plano = { ...plano, id: gerarId() };
  return put(STORES.plans, plano, { novo: novo || !plano.criadoEm });
}
export async function obterPlano(id) {
  return obter(STORES.plans, id);
}
export async function listarPlanos() {
  return listar(STORES.plans);
}
export async function planoAtivo() {
  const todos = await listarPlanos();
  return todos.find((p) => p.ativo) || null;
}

// ---------------------------------------------------------------------------
// phases
// ---------------------------------------------------------------------------
export async function salvarFase(fase, { novo = false } = {}) {
  if (!fase.id) fase = { ...fase, id: gerarId() };
  return put(STORES.phases, fase, { novo: novo || !fase.criadoEm });
}
export async function listarFases(planId) {
  const todas = await listar(STORES.phases);
  const filtradas = planId ? todas.filter((f) => f.planId === planId) : todas;
  return filtradas.sort((a, b) => a.numero - b.numero);
}

// ---------------------------------------------------------------------------
// plannedWorkouts
// ---------------------------------------------------------------------------
export async function salvarPlanned(w, { novo = false } = {}) {
  if (!w.id) w = { ...w, id: gerarId() };
  return put(STORES.plannedWorkouts, w, { novo: novo || !w.criadoEm });
}
export async function obterPlanned(id) {
  return obter(STORES.plannedWorkouts, id);
}
export async function listarPlanned({ planId, semana, status } = {}) {
  const todos = await listar(STORES.plannedWorkouts);
  let r = todos;
  if (planId) r = r.filter((w) => w.planId === planId);
  if (semana != null) r = r.filter((w) => w.semana === semana);
  if (status) r = r.filter((w) => w.status === status);
  return r.sort((a, b) => (a.dataPlanejada < b.dataPlanejada ? -1 : a.dataPlanejada > b.dataPlanejada ? 1 : 0));
}
export async function plannedNaData(dataISO) {
  return comTransacao(STORES.plannedWorkouts, "readonly", (tx) =>
    indexGetAll(tx, STORES.plannedWorkouts, "dataPlanejada", dataISO)
  );
}

/** Edita campos do planejado. Nunca toca em completedWorkouts. */
export async function editarPlanned(id, alteracoes) {
  return comTransacao(STORES.plannedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.plannedWorkouts, id);
    if (!atual) throw new Error(`Treino planejado não encontrado: ${id}`);
    const proibidos = ["id", "planId", "criadoEm"];
    const merged = { ...atual };
    for (const [k, v] of Object.entries(alteracoes)) {
      if (!proibidos.includes(k)) merged[k] = v;
    }
    const carimbado = carimbar(merged, { novo: false });
    tx.objectStore(STORES.plannedWorkouts).put(carimbado);
    return carimbado;
  });
}

/**
 * Reagenda um treino planejado. Preenche dataOriginal apenas na PRIMEIRA vez e
 * nunca a sobrescreve depois. Marca status='reagendado'.
 */
export async function reagendarPlanned(id, novaDataISO) {
  return comTransacao(STORES.plannedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.plannedWorkouts, id);
    if (!atual) throw new Error(`Treino planejado não encontrado: ${id}`);
    const merged = { ...atual };
    if (!merged.dataOriginal) merged.dataOriginal = atual.dataPlanejada; // só na 1ª vez
    merged.dataPlanejada = novaDataISO;
    merged.status = "reagendado";
    merged.sequence = (atual.sequence || 0) + 1; // p/ o .ics atualizar em vez de duplicar
    const carimbado = carimbar(merged, { novo: false });
    tx.objectStore(STORES.plannedWorkouts).put(carimbado);
    return carimbado;
  });
}

/** Altera apenas o status do planejado (ex.: marcar 'nao_realizado'). */
export async function marcarStatusPlanned(id, status) {
  return comTransacao(STORES.plannedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.plannedWorkouts, id);
    if (!atual) throw new Error(`Treino planejado não encontrado: ${id}`);
    const carimbado = carimbar({ ...atual, status }, { novo: false });
    tx.objectStore(STORES.plannedWorkouts).put(carimbado);
    return carimbado;
  });
}

// ---------------------------------------------------------------------------
// completedWorkouts
// ---------------------------------------------------------------------------
/**
 * Registra um treino realizado.
 *   - cria 1 completedWorkout
 *   - se vinculado a um planejado: garante que não exista outro para o mesmo
 *     plannedWorkoutId e altera SOMENTE o campo status do planejado -> 'concluido'
 * Tudo numa única transação sobre os dois stores.
 * `dados` já deve vir em unidades canônicas (metros, segundos, seg/km).
 */
export async function registrarTreino(dados) {
  const plannedWorkoutId = dados.plannedWorkoutId ?? null;
  return comTransacao([STORES.completedWorkouts, STORES.plannedWorkouts], "readwrite", async (tx) => {
    if (plannedWorkoutId != null) {
      const existentes = await indexGetAll(tx, STORES.completedWorkouts, "plannedWorkoutId", plannedWorkoutId);
      if (existentes.length > 0) {
        throw new Error(
          `Já existe um registro para este treino planejado (${plannedWorkoutId}). Use edição, não criação.`
        );
      }
    }
    const completed = carimbar(
      {
        id: dados.id || gerarId(),
        plannedWorkoutId,
        avulso: plannedWorkoutId == null,
        tipoAvulso: plannedWorkoutId == null ? (dados.tipoAvulso ?? null) : null,
        data: dados.data,
        duracaoSeg: dados.duracaoSeg ?? null,
        distanciaMetros: dados.distanciaMetros ?? null,
        paceSegPorKm: dados.paceSegPorKm ?? null,
        rpe: dados.rpe ?? null,
        fcMedia: dados.fcMedia ?? null,
        fcMaxima: dados.fcMaxima ?? null,
        sensacao: dados.sensacao ?? null,
        observacoes: dados.observacoes ?? null,
      },
      { novo: true }
    );
    tx.objectStore(STORES.completedWorkouts).add(completed);

    if (plannedWorkoutId != null) {
      const planned = await getReq(tx, STORES.plannedWorkouts, plannedWorkoutId);
      if (!planned) throw new Error(`Treino planejado vinculado não existe: ${plannedWorkoutId}`);
      // ALTERA SOMENTE o status. Nenhum outro campo do planejado é tocado.
      const plannedAtualizado = carimbar({ ...planned, status: "concluido" }, { novo: false });
      tx.objectStore(STORES.plannedWorkouts).put(plannedAtualizado);
    }
    return completed;
  });
}

/** Edita os campos próprios de um treino realizado. Nunca toca no planejado. */
export async function atualizarTreino(id, alteracoes) {
  return comTransacao(STORES.completedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.completedWorkouts, id);
    if (!atual) throw new Error(`Treino realizado não encontrado: ${id}`);
    const proibidos = ["id", "plannedWorkoutId", "criadoEm", "avulso"];
    const merged = { ...atual };
    for (const [k, v] of Object.entries(alteracoes)) {
      if (!proibidos.includes(k)) merged[k] = v;
    }
    const carimbado = carimbar(merged, { novo: false });
    tx.objectStore(STORES.completedWorkouts).put(carimbado);
    return carimbado;
  });
}
export async function obterCompleted(id) {
  return obter(STORES.completedWorkouts, id);
}
export async function listarCompleted() {
  const todos = await listar(STORES.completedWorkouts);
  return todos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0)); // recente primeiro
}
export async function completedPorPlanned(plannedWorkoutId) {
  return comTransacao(STORES.completedWorkouts, "readonly", async (tx) => {
    const r = await indexGetAll(tx, STORES.completedWorkouts, "plannedWorkoutId", plannedWorkoutId);
    return r[0] || null;
  });
}

// ---------------------------------------------------------------------------
// discomforts
// ---------------------------------------------------------------------------
export async function salvarDesconforto(d, { novo = true } = {}) {
  if (!d.id) d = { ...d, id: gerarId() };
  return put(STORES.discomforts, d, { novo: novo && !d.criadoEm });
}
export async function listarDesconfortosPorTreino(completedWorkoutId) {
  return comTransacao(STORES.discomforts, "readonly", (tx) =>
    indexGetAll(tx, STORES.discomforts, "completedWorkoutId", completedWorkoutId)
  );
}
export async function listarDesconfortos() {
  return listar(STORES.discomforts);
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------
export async function definirConfig(chave, valor) {
  return put(STORES.settings, { chave, valor }, { novo: true });
}
export async function obterConfig(chave, fallback = null) {
  const r = await obter(STORES.settings, chave);
  return r ? r.valor : fallback;
}
export async function obterConfigs() {
  const todas = await listar(STORES.settings);
  return Object.fromEntries(todas.map((s) => [s.chave, s.valor]));
}

// ---------------------------------------------------------------------------
// Backup / sync
// ---------------------------------------------------------------------------
const TODOS_STORES = [
  STORES.plans,
  STORES.phases,
  STORES.plannedWorkouts,
  STORES.completedWorkouts,
  STORES.discomforts,
  STORES.settings,
];

/** Dump completo de todos os stores, para exportação JSON. */
export async function exportarTudo() {
  const db = await abrirDB();
  const stores = {};
  await comTransacao(TODOS_STORES, "readonly", async (tx) => {
    for (const s of TODOS_STORES) stores[s] = await getAllReq(tx, s);
  });
  return {
    schemaVersion: db.version,
    exportadoEm: agoraISO(),
    stores,
  };
}

/**
 * Importa um dump com merge por ID, last-write-wins por atualizadoEm.
 * Nunca duplica. Devolve contagem de criados/atualizados/ignorados.
 * Registro sem atualizadoEm é tratado como muito antigo (nunca sobrescreve).
 */
export async function importarBackup(dump) {
  if (!dump || !dump.stores) throw new Error("Backup inválido: falta `stores`.");
  const relatorio = { criados: 0, atualizados: 0, ignorados: 0 };
  await comTransacao(TODOS_STORES, "readwrite", async (tx) => {
    for (const store of TODOS_STORES) {
      const entrada = dump.stores[store];
      if (!Array.isArray(entrada)) continue;
      const chave = chaveDe(store);
      for (const rec of entrada) {
        const key = rec[chave];
        if (key == null) {
          relatorio.ignorados++;
          continue;
        }
        const existente = await getReq(tx, store, key);
        if (!existente) {
          tx.objectStore(store).put(rec);
          relatorio.criados++;
        } else {
          const novoTs = rec.atualizadoEm || "";
          const velhoTs = existente.atualizadoEm || "";
          if (novoTs > velhoTs) {
            tx.objectStore(store).put(rec);
            relatorio.atualizados++;
          } else {
            relatorio.ignorados++;
          }
        }
      }
    }
  });
  return relatorio;
}

/** Lista registros pendentes de sync (para enviar ao Google Sheets). */
export async function listarPendentesSync() {
  const pendentes = {};
  await comTransacao(TODOS_STORES, "readonly", async (tx) => {
    for (const s of TODOS_STORES) {
      const todos = await getAllReq(tx, s);
      pendentes[s] = todos.filter((r) => r._pendingSync);
    }
  });
  return pendentes;
}

/** Marca como sincronizados (limpa _pendingSync) os registros informados. */
export async function marcarSincronizados(porStore) {
  await comTransacao(TODOS_STORES, "readwrite", async (tx) => {
    for (const [store, itens] of Object.entries(porStore)) {
      if (!Array.isArray(itens)) continue;
      const chave = chaveDe(store);
      for (const it of itens) {
        const atual = await getReq(tx, store, it[chave]);
        if (atual && atual._pendingSync) {
          atual._pendingSync = false;
          tx.objectStore(store).put(atual);
        }
      }
    }
  });
}

/** Contagem por store — utilitário para testes e diagnósticos. */
export async function contarTudo() {
  const contagem = {};
  await comTransacao(TODOS_STORES, "readonly", async (tx) => {
    for (const s of TODOS_STORES) contagem[s] = await req(tx.objectStore(s).count());
  });
  return contagem;
}
