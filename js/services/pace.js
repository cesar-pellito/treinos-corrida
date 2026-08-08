// pace.js — parsing de entrada, cálculo de pace e validações.
//
// Unidades canônicas do domínio: distância em METROS, tempo em SEGUNDOS,
// pace em SEGUNDOS POR KM. A conversão para km / mm:ss / "6:48 /km" acontece só
// aqui (camada de serviço/apresentação de entrada), nunca no repositório.
//
// Funções puras, sem DOM, sem IndexedDB.

// ---- Limites de validação (spec seção "Registro de treino") ----
export const LIMITES = {
  distKmMin: 0.1,
  distKmMax: 100,
  fcMin: 30,
  fcMax: 250,
  paceSegMin: 2 * 60, // 2:00 /km
  paceSegMax: 20 * 60, // 20:00 /km
};

/**
 * Interpreta distância digitada aceitando vírgula ou ponto ("6,84" ou "6.84").
 * Devolve METROS (inteiro) ou null se vazio; lança se não for número.
 */
export function parseDistanciaParaMetros(texto) {
  if (texto == null) return null;
  const t = String(texto).trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d*\.?\d+$/.test(t)) throw new Error(`Distância inválida: "${texto}"`);
  const km = Number(t);
  if (!Number.isFinite(km)) throw new Error(`Distância inválida: "${texto}"`);
  return Math.round(km * 1000);
}

/**
 * Interpreta tempo em "mm:ss" ou "hh:mm:ss" (ou segundos puros "125").
 * Devolve SEGUNDOS (inteiro) ou null se vazio.
 */
export function parseTempoParaSegundos(texto) {
  if (texto == null) return null;
  const t = String(texto).trim();
  if (t === "") return null;
  if (/^\d+$/.test(t)) return Number(t); // segundos puros
  const partes = t.split(":");
  if (partes.length < 2 || partes.length > 3) throw new Error(`Tempo inválido: "${texto}"`);
  if (!partes.every((p) => /^\d+$/.test(p))) throw new Error(`Tempo inválido: "${texto}"`);
  const nums = partes.map(Number);
  let seg;
  if (nums.length === 2) {
    const [mm, ss] = nums;
    if (ss >= 60) throw new Error(`Segundos fora de 0–59: "${texto}"`);
    seg = mm * 60 + ss;
  } else {
    const [hh, mm, ss] = nums;
    if (mm >= 60 || ss >= 60) throw new Error(`Minutos/segundos fora de 0–59: "${texto}"`);
    seg = hh * 3600 + mm * 60 + ss;
  }
  return seg;
}

/**
 * Pace em segundos por km, a partir de metros e segundos.
 * Devolve null se distância ou tempo forem nulos/zero (evita divisão por zero).
 */
export function calcularPaceSegPorKm(distanciaMetros, duracaoSeg) {
  if (!distanciaMetros || !duracaoSeg) return null;
  if (distanciaMetros <= 0 || duracaoSeg <= 0) return null;
  const km = distanciaMetros / 1000;
  return Math.round(duracaoSeg / km);
}

/** Formata pace (seg/km) como "6:48 /km". Devolve "—" se null. */
export function formatarPace(paceSegPorKm) {
  if (paceSegPorKm == null) return "—";
  const mm = Math.floor(paceSegPorKm / 60);
  const ss = Math.round(paceSegPorKm % 60);
  // arredondamento pode empurrar ss para 60
  const mmFinal = ss === 60 ? mm + 1 : mm;
  const ssFinal = ss === 60 ? 0 : ss;
  return `${mmFinal}:${String(ssFinal).padStart(2, "0")} /km`;
}

/** Formata duração (segundos) como "mm:ss" ou "h:mm:ss". */
export function formatarDuracao(duracaoSeg) {
  if (duracaoSeg == null) return "—";
  const h = Math.floor(duracaoSeg / 3600);
  const m = Math.floor((duracaoSeg % 3600) / 60);
  const s = duracaoSeg % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Formata metros como "6,84 km" (vírgula decimal, pt-BR). */
export function formatarDistanciaKm(distanciaMetros) {
  if (distanciaMetros == null) return "—";
  const km = distanciaMetros / 1000;
  return `${km.toFixed(2).replace(".", ",")} km`;
}

/**
 * Valida um registro. Não bloqueia: devolve lista de avisos (strings).
 * Lista vazia = tudo dentro das faixas.
 */
export function validarRegistro({ distanciaMetros, duracaoSeg, fcMedia, fcMaxima, paceSegPorKm }) {
  const avisos = [];
  if (distanciaMetros != null) {
    const km = distanciaMetros / 1000;
    if (km < LIMITES.distKmMin || km > LIMITES.distKmMax) {
      avisos.push(`Distância ${km.toFixed(2)} km fora da faixa ${LIMITES.distKmMin}–${LIMITES.distKmMax} km.`);
    }
  }
  if (duracaoSeg != null && duracaoSeg <= 0) {
    avisos.push("Tempo precisa ser positivo.");
  }
  for (const [rotulo, fc] of [["FC média", fcMedia], ["FC máxima", fcMaxima]]) {
    if (fc != null && (fc < LIMITES.fcMin || fc > LIMITES.fcMax)) {
      avisos.push(`${rotulo} ${fc} fora da faixa ${LIMITES.fcMin}–${LIMITES.fcMax} bpm.`);
    }
  }
  if (paceSegPorKm != null && (paceSegPorKm < LIMITES.paceSegMin || paceSegPorKm > LIMITES.paceSegMax)) {
    avisos.push(`Pace ${formatarPace(paceSegPorKm)} fora da faixa 2:00–20:00 /km.`);
  }
  return avisos;
}
