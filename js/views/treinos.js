// treinos.js — aba Treinos: Semana (agenda com checks e aderência) · Corrida
// (calendário do plano) · Evolução · Histórico. Os três últimos reaproveitam as
// views da corrida, embutidas.

import * as repo from "../data/repository.js";
import { carregarSemana, primeiroDiaSemana } from "../services/agenda.js";
import { resumoHoje } from "../services/schedule.js";
import { hoje as hojeISO, somarDias, inicioDaSemana, deISODate, nomeDiaSemana } from "../services/dates.js";
import { irPara, recarregar } from "./router.js";
import { el, card, botao, tituloVista, segmentos, barraProgresso } from "./components/ui.js";
import { linhaEntrada, sheetSessaoAvulsa, cardResumoSemana } from "./components/agenda-ui.js";
import { renderCalendario } from "./calendar.js";
import { renderEvolucao } from "./evolution.js";
import { renderHistorico } from "./history.js";

const SEGMENTOS = [
  { valor: "semana", rotulo: "Semana" },
  { valor: "corrida", rotulo: "Corrida" },
  { valor: "evolucao", rotulo: "Evolução" },
  { valor: "historico", rotulo: "Histórico" },
];

// Semana exibida no segmento "Semana" (sobrevive a recarregar(); volta para a
// semana atual ao reabrir o app).
let semanaRef = null;

const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export async function renderTreinos(container, param) {
  const seg = SEGMENTOS.some((s) => s.valor === param) ? param : "semana";
  container.appendChild(tituloVista("Treinos"));
  const seletor = segmentos(SEGMENTOS, { valorInicial: seg, onChange: (v) => irPara("treinos/" + v) }).node;
  seletor.classList.add("segmentos--cheio");
  container.appendChild(seletor);

  if (seg === "semana") return renderSemana(container);
  if (seg === "corrida") return renderCorrida(container);
  if (seg === "evolucao") return renderEvolucao(container, null, { embutido: true });
  return renderHistorico(container, null, { embutido: true });
}

// ---------------------------------------------------------------------------
// Semana
// ---------------------------------------------------------------------------
async function renderSemana(container) {
  const hoje = hojeISO();
  const pds = await primeiroDiaSemana();
  const atual = inicioDaSemana(hoje, pds);
  if (!semanaRef) semanaRef = atual;
  const r = await carregarSemana(semanaRef);

  const mudar = (dias) => { semanaRef = somarDias(semanaRef, dias); recarregar(); };
  const ehAtual = semanaRef === atual;
  container.appendChild(el("div", { class: "semana-nav" }, [
    botao("‹", { variante: "ghost", onClick: () => mudar(-7) }),
    el("span", { class: "strong", text: ehAtual ? "Esta semana" : `${ddmm(r.inicio)} a ${ddmm(r.fim)}` }),
    botao("›", { variante: "ghost", onClick: () => mudar(7) }),
  ]));
  if (!ehAtual) {
    container.appendChild(botao("Voltar para esta semana", { variante: "ghost", bloco: true, onClick: () => { semanaRef = atual; recarregar(); } }));
  }

  container.appendChild(cardResumoSemana(r, { titulo: `${ddmm(r.inicio)} a ${ddmm(r.fim)}` }));

  for (const dia of r.dias) {
    const cab = `${nomeDiaSemana(dia.data)} · ${ddmm(dia.data)}${dia.data === hoje ? " · hoje" : ""}`;
    container.appendChild(el("section", { class: `card dia-card${dia.data === hoje ? " dia-card--hoje" : ""}` }, [
      el("p", { class: "eyebrow", text: cab }),
      dia.entradas.length
        ? el("div", { class: "agenda-lista" }, dia.entradas.map((e) => linhaEntrada(e, dia.data)))
        : el("p", { class: "sub", text: "Descanso." }),
    ]));
  }

  container.appendChild(el("div", { class: "lista-acoes" }, [
    botao("+ Treino fora da agenda", { bloco: true, onClick: () => sheetSessaoAvulsa(hoje) }),
    botao("Editar agenda semanal", { variante: "ghost", bloco: true, onClick: () => irPara("agenda") }),
  ]));
}

// ---------------------------------------------------------------------------
// Corrida: progresso do plano + calendário
// ---------------------------------------------------------------------------
async function renderCorrida(container) {
  const plan = await repo.planoAtivo();
  if (plan) {
    const resumo = await resumoHoje(plan);
    const p = resumo.progresso;
    const n = resumo.streak;
    container.appendChild(card([
      el("p", { class: "eyebrow", text: `Semana ${resumo.semana} de ${plan.totalSemanas}${resumo.fase ? " · " + resumo.fase.nome : ""}` }),
      el("div", { class: "row-between" }, [
        el("span", { class: "strong", text: `${p.feitos} de ${p.total} corridas` }),
        el("span", { class: "muted", text: `${p.minFeitos} de ${p.minTotal} min` }),
      ]),
      el("div", { style: { marginTop: "10px" } }, [barraProgresso(p.total ? p.feitos / p.total : 0)]),
      el("p", { class: "sub", style: { marginTop: "10px" }, text: n === 0
        ? "Sequência: comece com 2+ corridas numa semana."
        : `Sequência: ${n} ${n === 1 ? "semana seguida" : "semanas seguidas"} com 2+ corridas.` }),
    ]));
  }
  await renderCalendario(container, null, { embutido: true });
}
