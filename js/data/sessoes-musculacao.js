// sessoes-musculacao.js — CONFIGURAÇÃO das sessões de musculação. Só dados.
//
// É daqui que o "Juntar sessões" monta a sugestão da sessão combinada. Edite à
// vontade: o app lê este arquivo e não tem nada disto fixo no código. Depois de
// editar, incremente CACHE_VERSAO no service-worker.js para o celular baixar a
// versão nova.
//
// Como editar:
//   - SESSOES: a chave é o rótulo da sessão na agenda ("Lower A", "Upper B"…),
//     comparado sem acento e sem caixa.
//   - Cada item:
//       nome     o que aparece na tela (alternativas separadas por " ou ")
//       slot     chave de deduplicação: dois itens com o mesmo slot em sessões
//                diferentes viram um só no merge (fica o de mais séries)
//       grupo    para o volume por grupo (chaves de GRUPOS abaixo)
//       papel    "composto" | "isolador" | "acessorio" (define a ordem e o que
//                cortar primeiro; acessório sai antes de tudo)
//       series   séries de trabalho (sem contar aquecimento)
//   - obrigatorios entram sempre; acessorios entram se couberem no teto.
//   - BISETS: pares de slots feitos em bi-set (contam o tempo de um só).
//   - Os números de séries são ponto de partida. Ajuste para o seu treino.
//
// Os rótulos do Upper A e do Upper B são um modelo genérico: troque pelos seus.

export const GRUPOS = {
  quadriceps: "Quadríceps",
  posterior_gluteo: "Posterior e glúteo",
  panturrilha: "Panturrilha",
  adutores: "Adutores",
  core: "Core",
  peito: "Peito",
  costas: "Costas",
  ombro: "Ombro",
  biceps: "Bíceps",
  triceps: "Tríceps",
};

export const SESSOES = {
  "Lower A": {
    foco: "quadríceps",
    obrigatorios: [
      { nome: "Leg press ou hack ou agachamento", slot: "quad_composto", grupo: "quadriceps", papel: "composto", series: 4 },
      { nome: "Extensora", slot: "extensora", grupo: "quadriceps", papel: "isolador", series: 3 },
      { nome: "Flexora", slot: "flexora", grupo: "posterior_gluteo", papel: "isolador", series: 3 },
      { nome: "Panturrilha", slot: "panturrilha", grupo: "panturrilha", papel: "isolador", series: 3 },
    ],
    acessorios: [
      { nome: "Adução", slot: "aducao", grupo: "adutores", papel: "acessorio", series: 2 },
    ],
  },
  "Lower B": {
    foco: "posterior e glúteo",
    obrigatorios: [
      { nome: "Stiff ou hip thrust", slot: "dobradica", grupo: "posterior_gluteo", papel: "composto", series: 4 },
      { nome: "Flexora", slot: "flexora", grupo: "posterior_gluteo", papel: "isolador", series: 3 },
      { nome: "Leg press ou búlgaro", slot: "quad_secundario", grupo: "quadriceps", papel: "composto", series: 3 },
      { nome: "Panturrilha", slot: "panturrilha", grupo: "panturrilha", papel: "isolador", series: 3 },
    ],
    acessorios: [
      { nome: "Adução", slot: "aducao", grupo: "adutores", papel: "acessorio", series: 2 },
      { nome: "Core", slot: "core", grupo: "core", papel: "acessorio", series: 2 },
    ],
  },
  "Upper A": {
    foco: "empurrar e remar",
    obrigatorios: [
      { nome: "Supino", slot: "supino", grupo: "peito", papel: "composto", series: 4 },
      { nome: "Remada", slot: "remada", grupo: "costas", papel: "composto", series: 4 },
      { nome: "Desenvolvimento", slot: "desenvolvimento", grupo: "ombro", papel: "composto", series: 3 },
      { nome: "Tríceps", slot: "triceps", grupo: "triceps", papel: "isolador", series: 3 },
    ],
    acessorios: [
      { nome: "Core", slot: "core", grupo: "core", papel: "acessorio", series: 2 },
    ],
  },
  "Upper B": {
    foco: "puxar e ombro",
    obrigatorios: [
      { nome: "Puxada", slot: "puxada", grupo: "costas", papel: "composto", series: 4 },
      { nome: "Supino inclinado", slot: "supino_inclinado", grupo: "peito", papel: "composto", series: 3 },
      { nome: "Elevação lateral", slot: "elevacao_lateral", grupo: "ombro", papel: "isolador", series: 3 },
      { nome: "Bíceps", slot: "biceps", grupo: "biceps", papel: "isolador", series: 3 },
    ],
    acessorios: [],
  },
};

// Pares feitos em bi-set quando os dois estão na sessão combinada.
export const BISETS = [["extensora", "flexora"]];

export const LIMITES = {
  tetoSeries: 20,          // séries de trabalho na sessão combinada (≈)
  alvoMin: [60, 70],       // duração-alvo em minutos
  aquecimentoMin: 8,
  minutosPorSerie: { composto: 3, isolador: 2, acessorio: 1.5 }, // série + descanso
};

// Meta semanal de séries por grupo, para comparar o volume da combinada.
export const META_SEMANAL = {
  quadriceps: 10,
  posterior_gluteo: 8,
  panturrilha: 6,
};
