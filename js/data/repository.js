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
// Toda escrita local carimba atualizadoEm: é o que o import de backup usa para
// decidir quem vence (last-write-wins).

import { STORES, TODOS_STORES, comTransacao, req, abrirDB } from "./db.js";
import { agoraISO, hoje as hojeISO } from "../services/dates.js";
import { corridaFeita } from "../services/dominio.js";

// Aviso de abertura bloqueada (upgrade de versão com outra aba aberta) — o
// bootstrap registra quem mostra a mensagem; ninguém acima importa db.js.
export { definirAoBloquear } from "./db.js";

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------
export function gerarId() {
  return globalThis.crypto.randomUUID();
}

function chaveDe(store) {
  return store === STORES.settings ? "chave" : "id";
}

/** Carimba criadoEm (se novo) e atualizadoEm numa escrita local. */
function carimbar(registro, { novo }) {
  const agora = agoraISO();
  const r = { ...registro };
  if (novo && !r.criadoEm) r.criadoEm = agora;
  r.atualizadoEm = agora;
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

/**
 * "Recomeçar o plano": arquiva o plano ativo (ativo=false). NADA é apagado —
 * planejados, realizados e desconfortos ficam no banco (e no backup), só deixam
 * de aparecer porque as telas filtram pelo plano ativo. Sem plano ativo, o boot
 * volta ao onboarding e um plano novo é semeado.
 */
export async function arquivarPlanoAtivo() {
  const atual = await planoAtivo();
  if (!atual) return null;
  return put(STORES.plans, { ...atual, ativo: false, arquivadoEm: agoraISO() }, { novo: false });
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

/**
 * Arrastar a corrida na semana: muda período e posição no dia (`periodo`,
 * `ordemDia`) e, se a data mudar, reagenda com as mesmas regras de
 * reagendarPlanned (dataOriginal só na 1ª vez, status 'reagendado', sequence).
 */
export async function reposicionarPlanned(id, { data, periodo, ordemDia }) {
  return comTransacao(STORES.plannedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.plannedWorkouts, id);
    if (!atual) throw new Error(`Treino planejado não encontrado: ${id}`);
    if (corridaFeita(atual.status)) throw new Error("Corrida já registrada não muda de dia.");
    const merged = { ...atual, periodo, ordemDia };
    if (data && data !== atual.dataPlanejada) {
      if (!merged.dataOriginal) merged.dataOriginal = atual.dataPlanejada;
      merged.dataPlanejada = data;
      merged.status = "reagendado";
      merged.sequence = (atual.sequence || 0) + 1;
    }
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
        ...(dados.encurtada ? { encurtada: true } : {}),
      },
      { novo: true }
    );
    tx.objectStore(STORES.completedWorkouts).add(completed);

    if (plannedWorkoutId != null) {
      const planned = await getReq(tx, STORES.plannedWorkouts, plannedWorkoutId);
      if (!planned) throw new Error(`Treino planejado vinculado não existe: ${plannedWorkoutId}`);
      // ALTERA SOMENTE o status (e, se encurtada, os minutos reais).
      const plannedAtualizado = carimbar(
        { ...planned, ...camposDeConclusao(!!dados.encurtada, dados.duracaoSeg) },
        { novo: false }
      );
      tx.objectStore(STORES.plannedWorkouts).put(plannedAtualizado);
    }
    return completed;
  });
}

/** Corrida encurtada conta como feita, com os minutos informados no registro. */
function camposDeConclusao(encurtada, duracaoSeg) {
  if (!encurtada) return { status: "concluido" };
  return { status: "encurtado", duracaoRealMin: duracaoSeg != null ? Math.round(duracaoSeg / 60) : 0 };
}

/** Corrige no formulário de edição se a corrida registrada foi encurtada ou não. */
export async function definirCorridaEncurtada(plannedWorkoutId, encurtada, duracaoSeg) {
  return comTransacao(STORES.plannedWorkouts, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.plannedWorkouts, plannedWorkoutId);
    if (!atual) throw new Error(`Treino planejado não encontrado: ${plannedWorkoutId}`);
    const { duracaoRealMin: _antigo, ...semMinutos } = atual;
    const carimbado = carimbar({ ...semMinutos, ...camposDeConclusao(encurtada, duracaoSeg) }, { novo: false });
    tx.objectStore(STORES.plannedWorkouts).put(carimbado);
    return carimbado;
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
/**
 * Lista realizados, recente primeiro. Com `planId`, só os daquele plano:
 *   - vinculado: pelo planId do planejado
 *   - avulso: pelo plano que estava ativo quando foi criado (o mais recente
 *     com criadoEm <= criadoEm do avulso; antes de qualquer plano => o primeiro)
 */
export async function listarCompleted({ planId } = {}) {
  let todos = await listar(STORES.completedWorkouts);
  if (planId) {
    const [planned, planos] = await Promise.all([listar(STORES.plannedWorkouts), listarPlanos()]);
    const planoDoPlanned = new Map(planned.map((w) => [w.id, w.planId]));
    const porCriacao = planos.sort((a, b) => ((a.criadoEm || "") < (b.criadoEm || "") ? -1 : 1));
    const planoDoAvulso = (c) => {
      let dono = porCriacao[0]?.id ?? null;
      for (const p of porCriacao) if ((p.criadoEm || "") <= (c.criadoEm || "")) dono = p.id;
      return dono;
    };
    todos = todos.filter((c) =>
      (c.plannedWorkoutId ? planoDoPlanned.get(c.plannedWorkoutId) : planoDoAvulso(c)) === planId
    );
  }
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
// Hub (v2) — utilidades comuns aos stores novos
//
// Exclusão é LÓGICA (tombstone): `removido: true` + atualizadoEm novo. O import
// de backup é merge last-write-wins sem DELETE; um registro apagado de verdade
// voltaria ao importar um backup antigo. As listagens filtram removidos.
// ---------------------------------------------------------------------------
const ativo = (r) => r && !r.removido;

async function listarPorData(store, de, ate) {
  return comTransacao(store, "readonly", (tx) =>
    req(tx.objectStore(store).index("data").getAll(globalThis.IDBKeyRange.bound(de, ate)))
  );
}

async function removerLogico(store, id) {
  return comTransacao(store, "readwrite", async (tx) => {
    const atual = await getReq(tx, store, id);
    if (!atual) throw new Error(`Registro não encontrado: ${id}`);
    const carimbado = carimbar({ ...atual, removido: true }, { novo: false });
    tx.objectStore(store).put(carimbado);
    return carimbado;
  });
}

/**
 * Seed idempotente: insere só os registros cujo `id` ainda não existe. Nunca
 * sobrescreve — um item que você editou ou removeu (tombstone) continua como está.
 * Os seeds usam UUIDs fixos, então reinstalar ou restaurar um backup
 * não duplica nada.
 */
export async function semearRegistros(store, registros) {
  return comTransacao(store, "readwrite", async (tx) => {
    let inseridos = 0;
    for (const r of registros) {
      if (await getReq(tx, store, r.id)) continue;
      tx.objectStore(store).put(carimbar(r, { novo: true }));
      inseridos++;
    }
    return inseridos;
  });
}

// ---------------------------------------------------------------------------
// weeklySchedule — a semana-padrão (configurável)
// ---------------------------------------------------------------------------
export const TIPOS_AGENDA = ["musculacao", "karate", "corrida"];
export const PERIODOS = ["manha", "noite"];

export async function salvarItemAgenda(item) {
  if (!TIPOS_AGENDA.includes(item.tipo)) throw new Error(`Tipo de atividade inválido: ${item.tipo}`);
  if (!PERIODOS.includes(item.periodo)) throw new Error(`Período inválido: ${item.periodo}`);
  if (!Number.isInteger(item.diaSemana) || item.diaSemana < 0 || item.diaSemana > 6) {
    throw new Error(`Dia da semana inválido: ${item.diaSemana}`);
  }
  const r = { rotulo: null, opcional: false, ordem: 0, ...item, id: item.id || gerarId() };
  return put(STORES.weeklySchedule, r, { novo: !item.criadoEm });
}
export async function listarAgenda() {
  return (await listar(STORES.weeklySchedule)).filter(ativo);
}
export async function removerItemAgenda(id) {
  return removerLogico(STORES.weeklySchedule, id);
}

// ---------------------------------------------------------------------------
// sessionLogs — check de musculação/karatê (a corrida usa completedWorkouts)
// ---------------------------------------------------------------------------
// "mesclada" (v4): a ocorrência foi juntada a outra numa sessão combinada
// (sessionMerges); o registro guarda `mergeId`. Só juntarSessoes grava este status.
export const STATUS_SESSAO = ["feito", "nao_feito", "mesclada"];
const ERRO_MESCLADA = "Esta sessão está numa sessão combinada. Desfaça o merge para mudar.";

// O status "pulado" saiu do app: só existe feito ou não feito. Registros antigos
// (e backups) continuam como estão no banco e são lidos como "não feito".
const lerStatus = (r) => (r.status === "pulado" ? { ...r, status: "nao_feito" } : r);

/**
 * Marca uma sessão. UM registro por (data, scheduleItemId): se já existe —
 * inclusive removido — ele é EDITADO e reativado, nunca duplicado. Sem
 * scheduleItemId (sessão fora da agenda) sempre cria um registro novo.
 * Campos ausentes (undefined) em `dados` mantêm o valor atual.
 * Quem chama passa o snapshot do item (tipo, rotulo, periodo, opcional): editar
 * a agenda depois não reescreve o histórico.
 */
export async function registrarSessao(dados) {
  if (!dados.data) throw new Error("Sessão sem data.");
  if (!STATUS_SESSAO.includes(dados.status) || dados.status === "mesclada") throw new Error(`Status inválido: ${dados.status}`);
  const itemId = dados.scheduleItemId ?? null;
  return comTransacao(STORES.sessionLogs, "readwrite", async (tx) => {
    let existente = null;
    if (itemId != null) {
      const doItem = await indexGetAll(tx, STORES.sessionLogs, "scheduleItemId", itemId);
      existente = doItem.find((s) => s.data === dados.data) || null;
    }
    if (existente && !existente.removido && existente.status === "mesclada") throw new Error(ERRO_MESCLADA);
    const base = existente
      ? { ...existente }
      : {
          id: gerarId(), scheduleItemId: itemId,
          duracaoMin: null, rpe: null, observacoes: null,
        };
    for (const [k, v] of Object.entries(dados)) {
      if (v !== undefined && k !== "id" && k !== "criadoEm") base[k] = v;
    }
    base.removido = false;
    const carimbado = carimbar(base, { novo: !existente });
    tx.objectStore(STORES.sessionLogs).put(carimbado);
    return carimbado;
  });
}
/** Edita campos de uma sessão existente pelo ID (duração, RPE, rótulo…). */
export async function atualizarSessao(id, alteracoes) {
  return comTransacao(STORES.sessionLogs, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.sessionLogs, id);
    if (!atual) throw new Error(`Sessão não encontrada: ${id}`);
    if (atual.status === "mesclada" && !atual.removido) throw new Error(ERRO_MESCLADA);
    if (alteracoes.status !== undefined && (!STATUS_SESSAO.includes(alteracoes.status) || alteracoes.status === "mesclada")) {
      throw new Error(`Status inválido: ${alteracoes.status}`);
    }
    const proibidos = ["id", "criadoEm", "scheduleItemId", "data"];
    const merged = { ...atual };
    for (const [k, v] of Object.entries(alteracoes)) {
      if (v !== undefined && !proibidos.includes(k)) merged[k] = v;
    }
    const carimbado = carimbar(merged, { novo: false });
    tx.objectStore(STORES.sessionLogs).put(carimbado);
    return carimbado;
  });
}
export async function obterSessao(id) {
  return obter(STORES.sessionLogs, id);
}
/** Sessões ativas, por data crescente. `de`/`ate` inclusivos (ISO). */
export async function listarSessoes({ de, ate } = {}) {
  const todas = de && ate ? await listarPorData(STORES.sessionLogs, de, ate) : await listar(STORES.sessionLogs);
  return todas.filter(ativo).map(lerStatus).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}
/** Desmarcar: tombstone (o próximo toque no mesmo item/dia reativa o registro). */
export async function removerSessao(id) {
  const atual = await obter(STORES.sessionLogs, id);
  if (atual && atual.status === "mesclada" && !atual.removido) throw new Error(ERRO_MESCLADA);
  return removerLogico(STORES.sessionLogs, id);
}

// ---------------------------------------------------------------------------
// scheduleMoves — item da agenda movido de dia/período numa semana
// ---------------------------------------------------------------------------

/**
 * Move a ocorrência de um item da agenda (a da semana de `dataOrigem`) para
 * `data`/`periodo`, na posição `ordem` dentro do período. UM registro por
 * (scheduleItemId, dataOrigem): mover de novo edita; `voltar` desfaz (tombstone).
 * `dataAtual` = onde a ocorrência está agora (= dataOrigem se nunca foi movida).
 *
 * O registro de sessão da ocorrência acompanha, na mesma transação:
 *   - mesma data: só muda o período;
 *   - outra data e "feito": o registro vai junto (o treino foi feito no outro dia);
 *   - outra data e "não feito": o registro sai (tombstone): o treino
 *     foi remarcado e volta a ficar pendente.
 */
export async function moverOcorrencia({ scheduleItemId, dataOrigem, dataAtual, data, periodo, ordem = 0, voltar = false }) {
  if (!scheduleItemId || !dataOrigem || !dataAtual || !data) throw new Error("Movimento incompleto.");
  if (!PERIODOS.includes(periodo)) throw new Error(`Período inválido: ${periodo}`);
  return comTransacao([STORES.scheduleMoves, STORES.sessionLogs], "readwrite", async (tx) => {
    const sessoes = await indexGetAll(tx, STORES.sessionLogs, "scheduleItemId", scheduleItemId);
    const log = sessoes.find((s) => s.data === dataAtual && !s.removido);
    if (log && log.status === "mesclada") throw new Error(ERRO_MESCLADA);
    if (log) {
      const st = tx.objectStore(STORES.sessionLogs);
      if (data === dataAtual) {
        st.put(carimbar({ ...log, periodo }, { novo: false }));
      } else {
        st.put(carimbar({ ...log, removido: true }, { novo: false }));
        if (log.status === "feito") {
          // reaproveita o registro do destino (mesmo removido): segue 1 por (data, item)
          const destino = sessoes.find((s) => s.data === data) || null;
          const { id, criadoEm, atualizadoEm, ...campos } = log;
          const base = destino ? { ...destino, ...campos } : { ...campos, id: gerarId() };
          st.put(carimbar({ ...base, data, periodo, removido: false }, { novo: !destino }));
        }
      }
    }

    const movimentos = await indexGetAll(tx, STORES.scheduleMoves, "scheduleItemId", scheduleItemId);
    const existente = movimentos.find((m) => m.dataOrigem === dataOrigem) || null;
    const ms = tx.objectStore(STORES.scheduleMoves);
    if (voltar) {
      if (existente && !existente.removido) ms.put(carimbar({ ...existente, removido: true }, { novo: false }));
      return null;
    }
    const base = existente ? { ...existente } : { id: gerarId(), scheduleItemId, dataOrigem };
    const carimbado = carimbar({ ...base, data, periodo, ordem, removido: false }, { novo: !existente });
    ms.put(carimbado);
    return carimbado;
  });
}

/** Movimentos ativos com destino entre `de` e `ate` (inclusivos). */
export async function listarMovimentos({ de, ate } = {}) {
  const todos = de && ate ? await listarPorData(STORES.scheduleMoves, de, ate) : await listar(STORES.scheduleMoves);
  return todos.filter(ativo);
}

// ---------------------------------------------------------------------------
// sessionMerges — duas sessões de musculação juntadas numa só (v4)
//
// As ocorrências de origem NÃO são apagadas: o registro de cada uma (o mesmo de
// sempre, 1 por (data, item)) ganha status "mesclada" e `mergeId`. O merge guarda
// as origens com o `logAnterior` (o registro antes do merge, ou null), que é o
// que "desfazer" restaura. Regras de semana e de tipo ficam em services/merge.js;
// aqui ficam as que protegem os dados.
// ---------------------------------------------------------------------------
export const STATUS_COMBINADA = [null, "feito", "nao_feito"];

/**
 * Cria a sessão combinada e marca as origens, numa transação.
 * `origens`: [{scheduleItemId, dataOcorrencia, dataOrigem, tipo, rotulo, periodo, opcional}].
 * Recusa: menos/mais de 2 origens, o mesmo item duas vezes, tipo diferente de
 * musculação, origem já feita ou já mesclada.
 */
export async function juntarSessoes({ origens, data, periodo, ordem = 0, rotulo, plano = null }) {
  if (!Array.isArray(origens) || origens.length !== 2) throw new Error("Escolha duas sessões para juntar.");
  if (origens[0].scheduleItemId === origens[1].scheduleItemId && origens[0].dataOcorrencia === origens[1].dataOcorrencia) {
    throw new Error("Escolha duas sessões diferentes.");
  }
  if (origens.some((o) => o.tipo !== "musculacao")) throw new Error("Só sessões de musculação podem ser juntadas.");
  if (!data) throw new Error("Sessão combinada sem data.");
  if (!PERIODOS.includes(periodo)) throw new Error(`Período inválido: ${periodo}`);
  return comTransacao([STORES.sessionMerges, STORES.sessionLogs], "readwrite", async (tx) => {
    const mergeId = gerarId();
    const st = tx.objectStore(STORES.sessionLogs);
    const gravadas = [];
    for (const o of origens) {
      const doItem = await indexGetAll(tx, STORES.sessionLogs, "scheduleItemId", o.scheduleItemId);
      const doDia = doItem.filter((s) => s.data === o.dataOcorrencia);
      const ativoNoDia = doDia.find((s) => !s.removido) || null;
      if (ativoNoDia && ativoNoDia.status === "feito") throw new Error(`${o.rotulo || "Sessão"} já foi feita.`);
      if (ativoNoDia && ativoNoDia.status === "mesclada") throw new Error(`${o.rotulo || "Sessão"} já está numa sessão combinada.`);
      const reaproveitado = ativoNoDia || doDia[0] || null; // segue 1 registro por (data, item)
      const base = reaproveitado
        ? { ...reaproveitado }
        : { id: gerarId(), scheduleItemId: o.scheduleItemId, data: o.dataOcorrencia, duracaoMin: null, rpe: null, observacoes: null };
      st.put(carimbar({
        ...base, tipo: o.tipo, rotulo: o.rotulo, periodo: o.periodo, opcional: !!o.opcional,
        status: "mesclada", mergeId, removido: false,
      }, { novo: !reaproveitado }));
      gravadas.push({
        scheduleItemId: o.scheduleItemId, rotulo: o.rotulo, periodo: o.periodo,
        dataOcorrencia: o.dataOcorrencia, dataOrigem: o.dataOrigem || o.dataOcorrencia,
        logAnterior: ativoNoDia ? { ...ativoNoDia } : null,
      });
    }
    const merge = carimbar({
      id: mergeId, tipo: "musculacao", data, periodo, ordem, rotulo, plano,
      origens: gravadas, status: null, duracaoMin: null, rpe: null, removido: false,
    }, { novo: true });
    tx.objectStore(STORES.sessionMerges).put(merge);
    return merge;
  });
}

/**
 * Desfaz o merge: as origens voltam ao registro de antes (ou deixam de ter
 * registro) e o merge vira tombstone. Recusado depois de a combinada ser feita.
 */
export async function desfazerMerge(id) {
  return comTransacao([STORES.sessionMerges, STORES.sessionLogs], "readwrite", async (tx) => {
    const merge = await getReq(tx, STORES.sessionMerges, id);
    if (!merge || merge.removido) throw new Error("Sessão combinada não encontrada.");
    if (merge.status === "feito") throw new Error("A sessão combinada já foi feita; não dá para desfazer.");
    const st = tx.objectStore(STORES.sessionLogs);
    for (const o of merge.origens) {
      const doItem = await indexGetAll(tx, STORES.sessionLogs, "scheduleItemId", o.scheduleItemId);
      const log = doItem.find((s) => s.data === o.dataOcorrencia && s.mergeId === id && !s.removido);
      if (!log) continue;
      st.put(carimbar(o.logAnterior ? { ...o.logAnterior, id: log.id } : { ...log, removido: true }, { novo: false }));
    }
    const carimbado = carimbar({ ...merge, removido: true }, { novo: false });
    tx.objectStore(STORES.sessionMerges).put(carimbado);
    return carimbado;
  });
}

/** Marca a combinada (status, duração, RPE). `status: null` volta a pendente. */
export async function atualizarMerge(id, alteracoes) {
  return comTransacao(STORES.sessionMerges, "readwrite", async (tx) => {
    const atual = await getReq(tx, STORES.sessionMerges, id);
    if (!atual || atual.removido) throw new Error("Sessão combinada não encontrada.");
    if (alteracoes.status !== undefined && !STATUS_COMBINADA.includes(alteracoes.status)) {
      throw new Error(`Status inválido: ${alteracoes.status}`);
    }
    const merged = { ...atual };
    for (const k of ["status", "duracaoMin", "rpe"]) if (alteracoes[k] !== undefined) merged[k] = alteracoes[k];
    const carimbado = carimbar(merged, { novo: false });
    tx.objectStore(STORES.sessionMerges).put(carimbado);
    return carimbado;
  });
}

export async function obterMerge(id) {
  return obter(STORES.sessionMerges, id);
}

/** Merges ativos com a combinada entre `de` e `ate` (inclusivos). */
export async function listarMerges({ de, ate } = {}) {
  const todos = de && ate ? await listarPorData(STORES.sessionMerges, de, ate) : await listar(STORES.sessionMerges);
  return todos.filter(ativo).map(lerStatus);
}

// ---------------------------------------------------------------------------
// Aba Semana (v5): check-in do dia, exceções da semana e histórico por semana.
// IDs estáveis por dia e por semana: importar um backup não duplica.
// ---------------------------------------------------------------------------

/** Um check-in por dia: salvar de novo edita. Fica guardado no histórico. */
export async function salvarCheckin(dados) {
  if (!dados.data) throw new Error("Check-in sem data.");
  const id = `checkin:${dados.data}`;
  const atual = await obter(STORES.dailyCheckins, id);
  return put(STORES.dailyCheckins, { ...(atual || {}), ...dados, id, removido: false }, { novo: !atual });
}
export async function obterCheckin(data) {
  const r = await obter(STORES.dailyCheckins, `checkin:${data}`);
  return ativo(r) ? r : null;
}
export async function listarCheckins({ de, ate } = {}) {
  const todos = de && ate ? await listarPorData(STORES.dailyCheckins, de, ate) : await listar(STORES.dailyCheckins);
  return todos.filter(ativo);
}

/** Exceção de um dia: `bloqueio` ("manha" | "noite" | "dia" | null) e `feriado`. */
export async function salvarExcecao({ data, bloqueio = null, feriado = false }) {
  if (!data) throw new Error("Exceção sem data.");
  const id = `excecao:${data}`;
  const atual = await obter(STORES.weekExceptions, id);
  return put(STORES.weekExceptions, { id, data, bloqueio, feriado, removido: !bloqueio && !feriado }, { novo: !atual });
}
export async function listarExcecoes({ de, ate } = {}) {
  const todas = de && ate ? await listarPorData(STORES.weekExceptions, de, ate) : await listar(STORES.weekExceptions);
  return todas.filter(ativo);
}

export function obterHistoricoSemana(inicio) {
  return obter(STORES.weekHistory, `semana:${inicio}`);
}
export function listarHistoricosSemana() {
  return listar(STORES.weekHistory);
}
export async function salvarHistoricoSemana(registro) {
  const id = `semana:${registro.inicio}`;
  const atual = await obter(STORES.weekHistory, id);
  return put(STORES.weekHistory, { ...registro, id }, { novo: !atual });
}

// ---------------------------------------------------------------------------
// foodLogs — refeições do plano e proteína extra
// ---------------------------------------------------------------------------

// `data` é o dia a que o registro se refere; `criadoEm`/`atualizadoEm`, quando
// foi lançado. Dá para lançar qualquer dia passado (registro retroativo), nunca
// um dia futuro.
function recusarFuturo(data) {
  if (data > hojeISO()) throw new Error("Não dá para registrar num dia futuro.");
}

/** ID estável de uma refeição do dia: dois aparelhos geram o mesmo, e o backup não duplica. */
export function idRefeicao(data, refeicaoId) {
  return `refeicao:${data}:${refeicaoId}`;
}

/** Entre registros da mesma (data, refeição), o ativo mais recente (ou o mais recente de todos). */
export function registroVigente(registros) {
  const recentes = [...registros].sort((a, b) => ((a.atualizadoEm || "") < (b.atualizadoEm || "") ? 1 : -1));
  return recentes.find((r) => !r.removido) || recentes[0] || null;
}

/**
 * Registra uma refeição do plano. UMA por (data, refeicaoId): se já existe —
 * inclusive removida — é EDITADA e reativada, nunca duplicada. Registros novos
 * usam o ID estável `idRefeicao` (os antigos mantêm o UUID). `macros` é o
 * snapshot da estimativa no momento do registro (mudar a tabela de estimativas
 * depois não reescreve o histórico).
 */
export async function registrarRefeicao(dados) {
  if (!dados.data || !dados.refeicaoId) throw new Error("Refeição sem data ou sem refeicaoId.");
  if (!(dados.fracao > 0)) throw new Error("Porção inválida.");
  recusarFuturo(dados.data);
  return comTransacao(STORES.foodLogs, "readwrite", async (tx) => {
    const doDia = await indexGetAll(tx, STORES.foodLogs, "data", dados.data);
    const existente = registroVigente(doDia.filter((r) => r.tipo === "refeicao" && r.refeicaoId === dados.refeicaoId));
    const base = existente ? { ...existente } : { id: idRefeicao(dados.data, dados.refeicaoId), tipo: "refeicao", escolhas: null };
    for (const [k, v] of Object.entries(dados)) {
      if (v !== undefined && k !== "id" && k !== "criadoEm" && k !== "tipo") base[k] = v;
    }
    base.removido = false;
    const carimbado = carimbar(base, { novo: !existente });
    tx.objectStore(STORES.foodLogs).put(carimbado);
    return carimbado;
  });
}

/** Proteína fora do plano (ex.: um shake). Cada lançamento é um registro. */
export async function registrarExtra({ data, proteinaG, descricao = null }) {
  if (!data) throw new Error("Lançamento sem data.");
  if (!(typeof proteinaG === "number" && proteinaG > 0 && proteinaG < 500)) throw new Error("Proteína extra inválida.");
  recusarFuturo(data);
  const r = { id: gerarId(), tipo: "extra", data, proteinaG, descricao, removido: false };
  return put(STORES.foodLogs, r, { novo: true });
}

/** Registros ativos, por data crescente. `de`/`ate` inclusivos (ISO). */
export async function listarRegistrosAlimentares({ de, ate } = {}) {
  const todos = de && ate ? await listarPorData(STORES.foodLogs, de, ate) : await listar(STORES.foodLogs);
  return todos.filter(ativo).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}
export async function removerRegistroAlimentar(id) {
  return removerLogico(STORES.foodLogs, id);
}

// ---------------------------------------------------------------------------
// Backup — TODOS_STORES vem do db.js (inclui os stores do hub)
// ---------------------------------------------------------------------------

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

/** Contagem por store — utilitário para testes e diagnósticos. */
export async function contarTudo() {
  const contagem = {};
  await comTransacao(TODOS_STORES, "readonly", async (tx) => {
    for (const s of TODOS_STORES) contagem[s] = await req(tx.objectStore(s).count());
  });
  return contagem;
}
