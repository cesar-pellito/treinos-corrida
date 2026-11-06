// rotas-config.js — CONSTANTES do motor de rotas. Só dados.
//
// Custos, penalidades, janelas de horário e catálogo ficam todos aqui, para
// calibrar sem mexer na lógica de services/motor-rotas.js. Depois de editar,
// incremente CACHE_VERSAO no service-worker.js para o celular baixar a versão nova.
//
// Horários em minutos desde a meia-noite (9h = 540).

// Um slot conta como passado quando a janela dele termina.
export const FIM_DO_SLOT = {
  manhaDiaUtil: 9 * 60,
  manhaFolga: 13 * 60, // sábado, domingo e feriado
  noite: 22 * 60,
};

// Horário de referência de cada slot, só para o intervalo de 48h entre treinos.
export const HORA_DE_REFERENCIA = {
  manhaDiaUtil: 7 * 60,
  manhaFolga: 9 * 60,
  noiteDiaUtil: 20 * 60,
  tardeFolga: 15 * 60,
};

// Noites de aula real, em Date.getDay() (0 = domingo … 6 = sábado).
export const NOITES_DE_KARATE = { intenso: [2], leve: [1, 3, 5] };

// O motor nunca sugere estes slots. Quem coloca um treino ali à mão pode: não gera aviso.
export const SLOTS_QUE_NUNCA_SUGERE = [{ dia: 0, periodo: "noite" }]; // domingo à tarde

// Prioridade: 1 é a mais alta. Família agrupa treinos para o intervalo de 48h.
export const CATALOGO = {
  intenso: { prioridade: 1, familia: "karate", nome: "Karatê intenso" },
  lower: { prioridade: 2, familia: "lower", nome: "Lower" },
  upper: { prioridade: 3, familia: "upper", nome: "Upper" },
  corrida: { prioridade: 4, familia: "corrida", nome: "Corrida" },
  leve: { prioridade: 5, familia: "karate", nome: "Karatê leve" },
};

// Só estes rótulos podem ser juntados pelo motor.
export const PARES_PARA_JUNTAR = [["Lower A", "Lower B"], ["Upper A", "Upper B"]];

export const LIMITES = {
  mudancasPorRota: 3,
  rotasNaTela: 3,
  folgaParaPreferirMenosMudancas: 10, // pontos de custo
  ideiasDescartadas: 3,
  motivosNoAlerta: 3,
  karatesPorSemana: 3,
  treinosPorDia: 2,
};

export const GATILHOS = {
  custoMinimoParaAvisar: 30, // custo de "não fazer": abaixo disso (karatê leve), o aviso não aparece sozinho
  pioraMinimaParaAlertar: 10, // pontos de penalidade que um ajuste à mão precisa somar para gerar alerta
};

export const CUSTOS = {
  mover: 10,
  juntar: 15,
  encurtar: 8,
  naoFazer: { intenso: 100, lower: 80, upper: 60, corrida: 30, leve: 10 },
};

export const PENALIDADES = {
  lowerVesperaIntenso: 25,
  lowerVesperaCorrida: 10,
  corridaDiasSeguidos: 10,
  lowerAntesDaCorrida: 10,
  mesmoGrupoMenosDe48h: 15,
  diaComDoisTreinos: 5,
  diaComDoisTreinosCansado: 20,
  lowerComDorEmLower: 40,
  upperComDorEmUpper: 40,
  altaPrioridadeCansado: 15,
};

export const CHECKIN = {
  padrao: { disposicao: 3, dorUpper: false, dorLower: false, fascia: false },
  cansadoAte: 2, // disposição 1 e 2 contam como "cansado"
  altaPrioridadeAte: 2, // prioridade 1 e 2 do catálogo
};

// Semana-padrão: a grade começa toda marcada; ajuste em Ajustes → Horários para treinar.
export const DISPONIBILIDADE_PADRAO = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((dia) => [dia, { manha: true, noite: true }])
);
