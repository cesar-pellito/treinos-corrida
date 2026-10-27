// today.js — tela Hoje do hub. Responde em segundos: o que está previsto hoje,
// o que já foi feito e como está a semana. Lançar algo leva 1 toque.

import * as repo from "../data/repository.js";
import { resumoHoje } from "../services/schedule.js";
import { carregarDia, carregarSemana } from "../services/agenda.js";
import { carregarDia as carregarDiaNutricao } from "../services/nutricao.js";
import { hoje as hojeISO, nomeDiaSemana, deISODate } from "../services/dates.js";
import { irPara } from "./router.js";
import { el, card, botao, tituloVista } from "./components/ui.js";
import { linhaEntrada, sheetSessaoAvulsa, cardResumoSemana, detalheCorrida } from "./components/agenda-ui.js";
import { cardProteina, cardRefeicoesHoje } from "./components/nutricao-ui.js";

function dataExtensa(iso) {
  const d = deISODate(iso);
  const dia = nomeDiaSemana(iso);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function cardAgenda(entradas, data, resumoCorrida) {
  const filhos = [el("p", { class: "eyebrow", text: "Agenda de hoje" })];
  if (!entradas.length) {
    filhos.push(el("p", { class: "sub", text: "Nada previsto para hoje." }));
  } else {
    filhos.push(el("div", { class: "agenda-lista" }, entradas.map((e) => linhaEntrada(e, data, { resumoCorrida }))));
  }
  filhos.push(el("div", { class: "agenda-acoes" }, [
    botao("+ Treino fora da agenda", { variante: "ghost", onClick: () => sheetSessaoAvulsa(data) }),
  ]));
  return card(filhos);
}

/** Toque abre/fecha o detalhe do treino (objetivo, metas e estrutura). */
function cardProximaCorrida(resumo) {
  const w = resumo.proximo;
  if (!w) return null;
  const dias = resumo.diasParaProximo;
  const quando = dias === 1 ? "amanhã" : `em ${dias} dias`;
  const fase = resumo.fase && resumo.fase.id === w.phaseId ? resumo.fase : null;
  const detalhe = detalheCorrida(w, fase);
  const cabeca = el("button", {
    type: "button", class: "mini mini--expansivel", "aria-expanded": "false",
    onClick: () => {
      const aberto = detalhe.classList.toggle("hidden") === false;
      cabeca.setAttribute("aria-expanded", String(aberto));
    },
  }, [
    el("div", { class: "esq" }, [
      el("span", { class: "rotulo", text: `${nomeDiaSemana(w.dataPlanejada)} · ${quando}` }),
      el("strong", { text: w.titulo }),
    ]),
    el("span", { class: "dir", text: `${w.duracaoMin} min · sem. ${w.semana}` }),
    el("span", { class: "mini__seta", "aria-hidden": "true" }),
  ]);
  return card([
    el("p", { class: "eyebrow", text: "Próxima corrida" }),
    el("div", { class: "mini-expansivel" }, [cabeca, detalhe]),
  ]);
}

export async function renderHoje(container) {
  const data = hojeISO();
  const plan = await repo.planoAtivo();
  const [entradas, semana, resumoCorrida, nutricao] = await Promise.all([
    carregarDia(data),
    carregarSemana(data),
    plan ? resumoHoje(plan, data) : Promise.resolve(null),
    carregarDiaNutricao(data),
  ]);

  container.appendChild(tituloVista("Hoje"));
  container.appendChild(el("p", { class: "hoje-data", text: dataExtensa(data) }));

  container.appendChild(cardAgenda(entradas, data, resumoCorrida));
  container.appendChild(cardProteina(nutricao));
  container.appendChild(cardRefeicoesHoje(nutricao));
  container.appendChild(cardResumoSemana(semana, { titulo: "Esta semana" }));

  const temCorridaHoje = entradas.some((e) => e.tipo === "corrida");
  if (resumoCorrida && !temCorridaHoje) {
    const prox = cardProximaCorrida(resumoCorrida);
    if (prox) container.appendChild(prox);
  }

  container.appendChild(botao("Registrar corrida avulsa", { bloco: true, onClick: () => irPara("avulso") }));
}
