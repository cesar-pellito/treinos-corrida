// horarios-editor.js — Ajustes → Horários para treinar. A semana-padrão: os slots
// que o motor de rotas pode sugerir. Exceções da semana ficam na aba Semana.

import { SLOTS_QUE_NUNCA_SUGERE } from "../data/rotas-config.js";
import { obterDisponibilidade, salvarDisponibilidade } from "../services/semana.js";
import { voltar } from "./router.js";
import { el, card, cabecalhoVoltar, toast } from "./components/ui.js";

// Segunda a domingo, em Date.getDay().
const DIAS = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [0, "Domingo"]];

export async function renderEditorHorarios(container) {
  container.appendChild(cabecalhoVoltar("Horários para treinar", voltar));
  const grade = await obterDisponibilidade();

  container.appendChild(el("p", { class: "sub", text: "Marque quando você normalmente pode treinar. As rotas só sugerem estes horários. Treinos já marcados na agenda continuam onde estão." }));

  const alternar = (dia, periodo) => async (ev) => {
    grade[dia] = { ...grade[dia], [periodo]: grade[dia][periodo] === false };
    ev.currentTarget.setAttribute("aria-pressed", String(grade[dia][periodo] !== false));
    try { await salvarDisponibilidade(grade); }
    catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
  };
  const chip = (dia, periodo, rotulo) => {
    if (SLOTS_QUE_NUNCA_SUGERE.some((s) => s.dia === dia && s.periodo === periodo)) {
      return el("button", { type: "button", class: "chip", text: rotulo, disabled: true, title: "As rotas não sugerem este horário" });
    }
    return el("button", {
      type: "button", class: "chip", text: rotulo, "aria-pressed": grade[dia][periodo] !== false, onClick: alternar(dia, periodo),
    });
  };

  container.appendChild(card([
    el("div", { class: "horarios" }, [
      el("span", {}), el("span", { class: "horarios__cab", text: "Manhã" }), el("span", { class: "horarios__cab", text: "Noite" }),
      ...DIAS.flatMap(([dia, nome]) => [
        el("span", { class: "horarios__dia", text: nome }),
        chip(dia, "manha", "Manhã"),
        chip(dia, "noite", dia === 0 || dia === 6 ? "Tarde" : "Noite"),
      ]),
    ]),
  ]));
  container.appendChild(el("p", { class: "sub", text: "O karatê continua nas noites de aula: segunda (leve), terça (intenso), quarta (leve) e sexta (leve). Dia útil: manhã até 9h e noite a partir de 19h. Sábado, domingo e feriado: manhã até 13h e tarde a partir de 13h. As rotas nunca sugerem domingo à tarde." }));
}
