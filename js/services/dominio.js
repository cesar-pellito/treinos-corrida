// dominio.js — listas de opções e rótulos do domínio (sem DOM, sem IndexedDB).

export const REGIOES = [
  { valor: "joelho", rotulo: "Joelho" },
  { valor: "panturrilha", rotulo: "Panturrilha" },
  { valor: "canela", rotulo: "Canela" },
  { valor: "quadril", rotulo: "Quadril" },
  { valor: "tornozelo", rotulo: "Tornozelo" },
  { valor: "pe", rotulo: "Pé" },
  { valor: "fascia_plantar_calcanhar", rotulo: "Fáscia plantar / calcanhar" },
  { valor: "lombar", rotulo: "Lombar" },
  { valor: "coxa", rotulo: "Coxa" },
  { valor: "outro", rotulo: "Outro" },
];

export const SENSACOES = [
  { valor: "muito_facil", rotulo: "Muito fácil" },
  { valor: "facil", rotulo: "Fácil" },
  { valor: "normal", rotulo: "Normal" },
  { valor: "dificil", rotulo: "Difícil" },
  { valor: "muito_dificil", rotulo: "Muito difícil" },
];

export const TIPOS = {
  corrida_caminhada: "Corrida/caminhada",
  continua: "Rodagem fácil",
  strides: "Rodagem + strides",
  fartlek: "Fartlek",
  limiar: "Limiar",
  longa: "Rodagem longa",
  avulso: "Treino avulso",
};

export const STATUS_ROTULO = {
  futuro: "Futuro",
  hoje: "Hoje",
  concluido: "Concluído",
  nao_realizado: "Não realizado",
  reagendado: "Reagendado",
  perdido: "Perdido",
};

// Zonas de intensidade do plano (RPE + % da FC máxima).
export const ZONAS_FC = [
  { nome: "Caminhada ativa", rpe: "2–3", pctMin: 50, pctMax: 60 },
  { nome: "Fácil (base)", rpe: "3–4", pctMin: 65, pctMax: 75 },
  { nome: "Moderado", rpe: "5–6", pctMin: 76, pctMax: 83 },
  { nome: "Limiar", rpe: "7–8", pctMin: 84, pctMax: 90 },
  { nome: "Forte", rpe: "9–10", pctMin: 91, pctMax: 100 },
];

/** Calcula as faixas de FC em bpm a partir da FC máxima. */
export function calcularZonasFC(fcMax) {
  return ZONAS_FC.map((z) => ({
    ...z,
    bpmMin: Math.round((z.pctMin / 100) * fcMax),
    bpmMax: Math.round((z.pctMax / 100) * fcMax),
    aberta: z.pctMax >= 100, // "Forte" é 91%+
  }));
}

export function rotuloRegiao(v) {
  return (REGIOES.find((r) => r.valor === v) || {}).rotulo || v;
}
export function rotuloSensacao(v) {
  return (SENSACOES.find((s) => s.valor === v) || {}).rotulo || v;
}
export function rotuloTipo(v) {
  return TIPOS[v] || v;
}
