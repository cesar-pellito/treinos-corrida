// sync.js — sincronização bidirecional com Google Sheets via Apps Script.
// Fica ATRÁS do repository: a UI nunca fala com o endpoint direto.
//
// Modelo: escrita é sempre local primeiro (IndexedDB). O sync roda em segundo
// plano quando há rede. Merge é last-write-wins por atualizadoEm (mesma lógica
// do import de backup). Nunca há estado "aguardando servidor" para usar o app.
//
// A URL do endpoint e o token ficam em settings (digitados em Ajustes, nunca
// commitados). O backend é o Apps Script em backend/Codigo.gs, publicado pelo
// próprio usuário.

import * as repo from "../data/repository.js";
import { agoraISO } from "./dates.js";

export async function estaConfigurado() {
  const url = await repo.obterConfig("syncUrl", null);
  return !!url;
}

async function config() {
  return {
    url: await repo.obterConfig("syncUrl", null),
    token: await repo.obterConfig("syncToken", ""),
    since: await repo.obterConfig("syncSince", ""),
  };
}

async function postar(url, corpo) {
  const resp = await fetch(url, {
    method: "POST",
    // text/plain evita preflight CORS com Apps Script
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(corpo),
  });
  if (!resp.ok) throw new Error(`Servidor respondeu ${resp.status}.`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.erro || "Resposta inválida do servidor.");
  return data;
}

/** Testa a conexão/token com o backend. */
export async function testarConexao() {
  const { url, token } = await config();
  if (!url) throw new Error("Configure a URL de sincronização.");
  const data = await postar(url, { acao: "ping", token });
  return data;
}

/**
 * Executa uma rodada de sincronização.
 * @returns {{enviados:number, pull:{criados,atualizados,ignorados}, serverTime:string}}
 */
export async function sincronizar() {
  const { url, token, since } = await config();
  if (!url) throw new Error("Sincronização não configurada.");

  // 1) coleta pendentes locais
  const pend = await repo.listarPendentesSync();
  const enviados = Object.values(pend).reduce((a, arr) => a + arr.length, 0);

  // 2) envia e recebe mudanças do servidor desde `since`
  const data = await postar(url, { acao: "sync", token, since, push: pend });

  // 3) aplica o que veio do servidor (last-write-wins por atualizadoEm)
  const pull = data.records ? await repo.importarBackup({ stores: data.records }) : { criados: 0, atualizados: 0, ignorados: 0 };

  // 4) marca como sincronizado o que enviamos
  await repo.marcarSincronizados(pend);

  // 5) avança o cursor
  await repo.definirConfig("syncSince", data.serverTime || "");
  await repo.definirConfig("ultimoSync", agoraISO());

  return { enviados, pull, serverTime: data.serverTime };
}

/** Última sincronização (ISO) ou null. */
export async function ultimoSync() {
  return repo.obterConfig("ultimoSync", null);
}

/** Sincroniza se estiver configurado e online. Silencioso em falha de rede. */
export async function sincronizarSePossivel() {
  if (!(await estaConfigurado())) return null;
  if (!navigator.onLine) return null;
  try { return await sincronizar(); }
  catch { return null; }
}
