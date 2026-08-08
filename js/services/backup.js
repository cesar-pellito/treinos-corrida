// backup.js — exportação/importação JSON e download de arquivos. Depende só do
// repository (não conhece IndexedDB). Três caminhos de saída porque iOS em modo
// standalone às vezes barra download direto.

import * as repo from "../data/repository.js";
import { agoraISO, hoje, diffDias } from "./dates.js";

/** Gera o objeto de backup completo. */
export async function gerarBackup() {
  return repo.exportarTudo();
}

function nomeArquivo(prefixo, ext) {
  return `${prefixo}-${hoje()}.${ext}`;
}

/**
 * Entrega um texto como arquivo. Tenta Web Share (arquivo), depois download,
 * depois cópia para a área de transferência. Retorna o método usado.
 */
export async function entregarArquivo(nome, conteudo, mime) {
  const blob = new Blob([conteudo], { type: mime });
  const file = new File([blob], nome, { type: mime });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return "share"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelado"; /* segue p/ download */ }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "download";
  } catch (e) {
    try { await navigator.clipboard.writeText(conteudo); return "clipboard"; }
    catch { throw new Error("Não foi possível entregar o arquivo. Copie manualmente."); }
  }
}

/** Exporta o backup JSON e marca a data do último backup. */
export async function exportarBackup() {
  const backup = await gerarBackup();
  const texto = JSON.stringify(backup, null, 2);
  const metodo = await entregarArquivo(nomeArquivo("treinos-corrida-backup", "json"), texto, "application/json");
  if (metodo !== "cancelado") await repo.definirConfig("ultimoBackup", agoraISO());
  return { metodo, tamanho: texto.length };
}

/** Importa um backup a partir do texto de um arquivo. Devolve o relatório. */
export async function importarBackupTexto(texto) {
  let dump;
  try { dump = JSON.parse(texto); }
  catch { throw new Error("Arquivo não é um JSON válido."); }
  return repo.importarBackup(dump);
}

/** Dias desde o último backup (null se nunca). */
export async function diasDesdeUltimoBackup() {
  const ultimo = await repo.obterConfig("ultimoBackup", null);
  if (!ultimo) return null;
  return diffDias(ultimo.slice(0, 10), hoje());
}

/** Estado do backup para a UI: {nunca, dias, vencido}. Vencido = >14 dias ou nunca. */
export async function estadoBackup() {
  const dias = await diasDesdeUltimoBackup();
  return { nunca: dias == null, dias, vencido: dias == null || dias > 14 };
}
