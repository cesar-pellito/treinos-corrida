// grupos-musculares.js — classificação de exercício (nome do Gravl) por grupo.
//
// COMO EDITAR: a lista REGRAS é lida de cima para baixo e vale a PRIMEIRA regra
// em que algum termo aparece no nome do exercício. Por isso a ordem importa:
//   - "calf" vem antes de "leg press" ("Calf Press on Leg Press" é panturrilha)
//   - "leg curl" (posterior) vem antes de "curl" (bíceps)
//   - "upright row" (ombros) vem antes de "row" (costas)
// Termos casam no começo de uma palavra, sem acento e sem caixa: "glute" acha
// "Glutes" e "Glute Bridge"; "row" acha "Seated Row", mas não "Narrow".
// Exercícios que não casam com nada viram "outro" e aparecem listados na
// importação, para você acrescentar o termo aqui.

export const GRUPOS = {
  quadriceps: "Quadríceps",
  posteriorGluteo: "Posterior e glúteo",
  panturrilha: "Panturrilha",
  peito: "Peito",
  costas: "Costas",
  ombros: "Ombros",
  biceps: "Bíceps",
  triceps: "Tríceps",
  core: "Core",
  outro: "Outro",
};

/** Grupos que contam como "perna" (metas de séries semanais). */
export const GRUPOS_PERNA = ["quadriceps", "posteriorGluteo", "panturrilha"];

export const REGRAS = [
  { grupo: "panturrilha", termos: ["calf", "calves", "panturrilha", "gemeos", "soleus"] },
  { grupo: "posteriorGluteo", termos: ["hamstring", "leg curl", "lying curl", "seated curl", "nordic", "romanian", "rdl", "stiff", "deadlift", "glute", "hip thrust", "good morning", "abduct", "abducao", "mesa flexora", "cadeira flexora", "elevacao pelvica"] },
  { grupo: "quadriceps", termos: ["leg press", "leg extension", "squat", "lunge", "split squat", "hack", "step up", "step-up", "sissy", "pistol", "agachamento", "afundo", "cadeira extensora"] },
  { grupo: "ombros", termos: ["shoulder", "overhead press", "military press", "lateral raise", "front raise", "rear delt", "reverse fly", "face pull", "arnold", "upright row", "desenvolvimento", "elevacao lateral"] },
  { grupo: "peito", termos: ["bench press", "chest", "fly", "flye", "pec deck", "push up", "push-up", "pushup", "dip", "supino", "crucifixo"] },
  { grupo: "costas", termos: ["row", "pulldown", "pull-down", "pull down", "pull up", "pull-up", "pullup", "chin up", "chin-up", "pullover", "shrug", "back extension", "remada", "puxada"] },
  { grupo: "triceps", termos: ["tricep", "skull crusher", "pushdown", "push down", "overhead extension", "kickback", "close grip", "triceps"] },
  { grupo: "biceps", termos: ["curl", "bicep", "rosca"] },
  { grupo: "core", termos: ["plank", "crunch", "sit up", "sit-up", "leg raise", "knee raise", "russian twist", "pallof", "dead bug", "ab wheel", "ab rollout", "abdominal", "prancha", "woodchop"] },
];
