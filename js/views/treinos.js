// treinos.js — aba Treinos: Semana (agenda com checks e aderência) · Corrida
// (calendário do plano) · Evolução · Histórico. Os três últimos reaproveitam as
// views da corrida, embutidas.

import * as repo from "../data/repository.js";
import { carregarSemana, primeiroDiaSemana, podeMover, moverEntrada, ROTULO_PERIODO } from "../services/agenda.js";
import { resumoHoje } from "../services/schedule.js";
import { hoje as hojeISO, somarDias, inicioDaSemana, deISODate, nomeDiaSemana } from "../services/dates.js";
import { irPara, recarregar } from "./router.js";
import { el, card, botao, tituloVista, segmentos, barraProgresso, toast } from "./components/ui.js";
import { linhaEntrada, sheetSessaoAvulsa, cardResumoSemana } from "./components/agenda-ui.js";
import { ativarArrastar } from "./components/arrastar.js";
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

/** Ordem para quem entra na posição `indice` entre linhas com as ordens `ordens`. */
function ordemNaPosicao(ordens, indice) {
  if (!ordens.length) return 0;
  if (indice <= 0) return ordens[0] - 1;
  if (indice >= ordens.length) return ordens[ordens.length - 1] + 1;
  return (ordens[indice - 1] + ordens[indice]) / 2;
}

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
  container.appendChild(el("p", { class: "dica-arrastar", text: "Segure um treino e arraste para outro dia ou período." }));

  // Cada dia tem uma vaga por período; as vazias só aparecem durante o arrasto.
  const arrastaveis = new Map();
  const semana = el("div", { class: "semana-dias" });
  for (const dia of r.dias) {
    const cab = `${nomeDiaSemana(dia.data)} · ${ddmm(dia.data)}${dia.data === hoje ? " · hoje" : ""}`;
    const vagas = Object.keys(ROTULO_PERIODO).map((periodo) => {
      const linhas = dia.entradas.filter((e) => e.periodo === periodo).map((e) => {
        const no = linhaEntrada(e, dia.data);
        no.dataset.ordem = String(e.ordem);
        if (podeMover(e)) arrastaveis.set(no, { entrada: e, data: dia.data });
        return no;
      });
      return el("div", {
        class: `slot${linhas.length ? "" : " slot--vazio"}`,
        dataset: { data: dia.data, periodo, rotulo: `Soltar aqui · ${ROTULO_PERIODO[periodo]}` },
      }, linhas);
    });
    semana.appendChild(el("section", { class: `card dia-card${dia.data === hoje ? " dia-card--hoje" : ""}` }, [
      el("p", { class: "eyebrow", text: cab }),
      dia.entradas.length ? null : el("p", { class: "sub dia-card__descanso", text: "Descanso." }),
      el("div", { class: "agenda-lista" }, vagas),
    ]));
  }
  container.appendChild(semana);

  ativarArrastar(semana, {
    linhas: arrastaveis,
    aoSoltar: async ({ contexto, data, periodo, indice, vizinhas }) => {
      const ordem = ordemNaPosicao(vizinhas.map((n) => Number(n.dataset.ordem)), indice);
      try {
        await moverEntrada(contexto.entrada, contexto.data, { data, periodo, ordem });
        toast(`Movido para ${nomeDiaSemana(data)} · ${ROTULO_PERIODO[periodo].toLowerCase()}`);
      } catch (e) {
        toast("Não foi possível mover: " + (e && e.message));
      }
      await recarregar();
    },
  });

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
