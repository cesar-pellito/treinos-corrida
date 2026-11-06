// aviso-semana.js — "Sua semana mudou, ver rotas", no topo de Hoje e de Treinos.

import { situacaoSemana } from "../../services/semana.js";
import { irPara } from "../router.js";
import { el } from "./ui.js";

/** Devolve o aviso, ou null com a semana em dia. Uma falha aqui não derruba a tela. */
export async function avisoSemana() {
  try {
    const { aviso } = await situacaoSemana();
    if (!aviso) return null;
    return el("button", { type: "button", class: "aviso-semana", text: "Sua semana mudou, ver rotas ›", onClick: () => irPara("semana") });
  } catch (e) {
    console.warn("Aviso da semana indisponível:", e);
    return null;
  }
}
