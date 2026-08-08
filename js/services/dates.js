// dates.js — utilidades de data em ISO (YYYY-MM-DD) tratadas SEMPRE em fuso local.
//
// O bug clássico: new Date('2026-08-03') é interpretado como UTC meia-noite, e em
// fusos a oeste de Greenwich (Brasil = UTC-3) isso "volta" para 2026-08-02 ao ler
// componentes locais. Toda esta camada evita isso: nunca passamos uma string
// 'YYYY-MM-DD' direto para new Date(). Sempre quebramos em ano/mês/dia e usamos o
// construtor numérico new Date(ano, mes-1, dia), que é local por definição.
//
// Camada de serviço: funções puras, sem DOM, sem IndexedDB.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Converte um Date para 'YYYY-MM-DD' usando os componentes LOCAIS. */
export function paraISODate(date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Converte 'YYYY-MM-DD' para um Date à meia-noite LOCAL (sem deslocamento UTC). */
export function deISODate(iso) {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Data ISO inválida: ${iso}`);
  const [, ano, mes, dia] = m;
  const d = new Date(Number(ano), Number(mes) - 1, Number(dia));
  // Guarda contra datas impossíveis (ex.: 2026-02-30 -> rola para março).
  if (d.getMonth() !== Number(mes) - 1 || d.getDate() !== Number(dia)) {
    throw new Error(`Data inexistente no calendário: ${iso}`);
  }
  return d;
}

/** true se a string é uma data ISO válida e existente. */
export function ehISODateValida(iso) {
  try {
    deISODate(iso);
    return true;
  } catch {
    return false;
  }
}

/** Data de hoje como 'YYYY-MM-DD' local. */
export function hoje() {
  return paraISODate(new Date());
}

/** Soma n dias (pode ser negativo) a uma data ISO e devolve ISO. */
export function somarDias(iso, n) {
  const d = deISODate(iso);
  d.setDate(d.getDate() + n);
  return paraISODate(d);
}

/** Diferença em dias inteiros: (isoB - isoA). Positivo se B é depois de A. */
export function diffDias(isoA, isoB) {
  const MS_DIA = 24 * 60 * 60 * 1000;
  // Normaliza pelo meio-dia local para evitar erro de 1 dia em transições de DST.
  const a = deISODate(isoA).getTime() + 12 * 60 * 60 * 1000;
  const b = deISODate(isoB).getTime() + 12 * 60 * 60 * 1000;
  return Math.round((b - a) / MS_DIA);
}

/** Dia da semana: 0=domingo, 1=segunda, ... 6=sábado (local). */
export function diaDaSemana(iso) {
  return deISODate(iso).getDay();
}

/**
 * Recua uma data ISO até o início da sua semana, dado o primeiro dia da semana
 * (0=domingo, 1=segunda). Devolve o ISO do início da semana (<= iso).
 */
export function inicioDaSemana(iso, primeiroDiaSemana = 1) {
  const dow = diaDaSemana(iso);
  const recuo = (dow - primeiroDiaSemana + 7) % 7;
  return somarDias(iso, -recuo);
}

/** Timestamp ISO completo (UTC, com Z) para criadoEm/atualizadoEm. */
export function agoraISO() {
  return new Date().toISOString();
}

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const NOMES_DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Nome do dia da semana em português. curto=true devolve abreviação. */
export function nomeDiaSemana(iso, curto = false) {
  const i = diaDaSemana(iso);
  return curto ? NOMES_DIA_CURTO[i] : NOMES_DIA[i];
}
