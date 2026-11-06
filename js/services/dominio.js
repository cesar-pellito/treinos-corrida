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
  encurtado: "Encurtado",
  nao_realizado: "Não realizado",
  reagendado: "Reagendado",
  perdido: "Perdido",
};

/** Corrida encurtada conta como feita, com carga menor. */
export function corridaFeita(status) {
  return status === "concluido" || status === "encurtado";
}

// Zonas de intensidade do plano (RPE + % da FC máxima).
export const ZONAS_FC = [
  { codigo: "Z1", nome: "Caminhada ativa", rpe: "2–3", pctMin: 50, pctMax: 60 },
  { codigo: "Z2", nome: "Fácil (base)", rpe: "3–4", pctMin: 65, pctMax: 75 },
  { codigo: "Z3", nome: "Moderado", rpe: "5–6", pctMin: 76, pctMax: 83 },
  { codigo: "Z4", nome: "Limiar", rpe: "7–8", pctMin: 84, pctMax: 90 },
  { codigo: "Z5", nome: "Forte", rpe: "9–10", pctMin: 91, pctMax: 100 },
];

export const FC_MAXIMA_PADRAO = 190; // 220 − 30 anos

/** Calcula as faixas de FC em bpm a partir da FC máxima. */
export function calcularZonasFC(fcMax) {
  return ZONAS_FC.map((z) => {
    const bpmMin = Math.round((z.pctMin / 100) * fcMax);
    const bpmMax = Math.round((z.pctMax / 100) * fcMax);
    // "Forte" é 91%+
    return { ...z, bpmMin, bpmMax, bpm: z.pctMax >= 100 ? `${bpmMin}+ bpm` : `${bpmMin}–${bpmMax} bpm` };
  });
}

/** Faixa gravada no plano ("65–75%") como zona: "Z2 · 124–143 bpm". Faixa desconhecida fica como está. */
export function textoZonaFC(faixa, fcMax) {
  const pctMin = parseInt(faixa, 10);
  const zona = calcularZonasFC(fcMax || FC_MAXIMA_PADRAO).find((z) => z.pctMin === pctMin);
  return zona ? `${zona.codigo} · ${zona.bpm}` : faixa;
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
