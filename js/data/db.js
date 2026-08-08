// db.js — abertura, schema e transações do IndexedDB.
//
// Esta é a ÚNICA camada que conhece a API do IndexedDB. Ninguém acima (services,
// views) deve importar este módulo diretamente: tudo passa por repository.js.
//
// Fonte da verdade dos dados. Não é cache de servidor. A sincronização opcional
// com Google Sheets (Etapa 7) lê/escreve por cima do repository, não daqui.

export const DB_NOME = "treinos-corrida";
export const DB_VERSAO = 1;

// Nomes dos object stores. Seis stores, conforme a spec.
export const STORES = {
  plans: "plans",
  phases: "phases",
  plannedWorkouts: "plannedWorkouts",
  completedWorkouts: "completedWorkouts",
  discomforts: "discomforts",
  settings: "settings",
};

// Todos os stores exceto settings usam campos de sync (atualizadoEm, _pendingSync).
export const STORES_SINCRONIZAVEIS = [
  STORES.plans,
  STORES.phases,
  STORES.plannedWorkouts,
  STORES.completedWorkouts,
  STORES.discomforts,
  STORES.settings,
];

let _dbPromise = null;

/**
 * Abre (e cria/atualiza) o banco. Idempotente: reaproveita a mesma conexão.
 * Usa globalThis.indexedDB para funcionar tanto no navegador quanto em testes
 * headless (fake-indexeddb) sem alterar o código de produção.
 */
export function abrirDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) {
      reject(new Error("IndexedDB indisponível neste ambiente."));
      return;
    }
    const req = idb.open(DB_NOME, DB_VERSAO);

    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const versaoAntiga = ev.oldVersion;
      criarSchema(db, versaoAntiga);
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // Outra aba pediu upgrade: fechamos para não travá-la.
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => reject(req.error || new Error("Falha ao abrir o banco."));
    req.onblocked = () => reject(new Error("Abertura do banco bloqueada por outra aba aberta."));
  });
  return _dbPromise;
}

/** Cria/migra os stores. Migrações futuras entram como `if (versaoAntiga < N)`. */
function criarSchema(db, versaoAntiga) {
  if (versaoAntiga < 1) {
    const plans = db.createObjectStore(STORES.plans, { keyPath: "id" });
    plans.createIndex("ativo", "ativo", { unique: false });

    const phases = db.createObjectStore(STORES.phases, { keyPath: "id" });
    phases.createIndex("planId", "planId", { unique: false });
    phases.createIndex("numero", "numero", { unique: false });

    const planned = db.createObjectStore(STORES.plannedWorkouts, { keyPath: "id" });
    planned.createIndex("planId", "planId", { unique: false });
    planned.createIndex("phaseId", "phaseId", { unique: false });
    planned.createIndex("semana", "semana", { unique: false });
    planned.createIndex("dataPlanejada", "dataPlanejada", { unique: false });
    planned.createIndex("status", "status", { unique: false });

    const completed = db.createObjectStore(STORES.completedWorkouts, { keyPath: "id" });
    // NÃO é unique: plannedWorkoutId pode ser null (treino avulso) para vários
    // registros. A unicidade por plannedWorkoutId é garantida no repository.
    completed.createIndex("plannedWorkoutId", "plannedWorkoutId", { unique: false });
    completed.createIndex("data", "data", { unique: false });

    const discomforts = db.createObjectStore(STORES.discomforts, { keyPath: "id" });
    discomforts.createIndex("completedWorkoutId", "completedWorkoutId", { unique: false });
    discomforts.createIndex("data", "data", { unique: false });
    discomforts.createIndex("regiao", "regiao", { unique: false });

    db.createObjectStore(STORES.settings, { keyPath: "chave" });
  }
}

/**
 * Executa `fn(tx)` dentro de uma transação e resolve com o valor retornado por
 * `fn` SOMENTE após o `oncomplete` da transação (garante durabilidade).
 * Qualquer erro aborta a transação e rejeita — nada de catch silencioso.
 *
 * @param {string|string[]} stores  store(s) envolvidas
 * @param {"readonly"|"readwrite"} modo
 * @param {(tx: IDBTransaction) => any} fn
 */
export async function comTransacao(stores, modo, fn) {
  const db = await abrirDB();
  const nomes = Array.isArray(stores) ? stores : [stores];
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(nomes, modo);
    } catch (e) {
      reject(e);
      return;
    }
    let resultado;
    let erroFn = null;

    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error || erroFn || new Error("Erro de transação."));
    tx.onabort = () => reject(tx.error || erroFn || new Error("Transação abortada."));

    Promise.resolve()
      .then(() => fn(tx))
      .then((r) => {
        resultado = r;
      })
      .catch((e) => {
        erroFn = e;
        try {
          tx.abort();
        } catch {
          reject(e);
        }
      });
  });
}

/** Envolve um IDBRequest numa Promise. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Apaga o banco inteiro (usado em testes e em "restaurar do zero"). */
export function apagarDB() {
  _dbPromise = null;
  return new Promise((resolve, reject) => {
    const r = globalThis.indexedDB.deleteDatabase(DB_NOME);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve(); // segue mesmo bloqueado; próxima abertura recria
  });
}
