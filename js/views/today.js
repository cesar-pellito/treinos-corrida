// today.js — tela Hoje do hub. Responde em segundos: o que está previsto hoje,
// o que já foi feito e como está a semana. Lançar algo leva 1 toque.

import * as repo from "../data/repository.js";
import { resumoHoje } from "../services/schedule.js";
import { carregarDia, carregarSemana } from "../services/agenda.js";
import { carregarDia as carregarDiaNutricao } from "../services/nutricao.js";
import { carregarCorpo } from "../services/corpo.js";
import { hoje as hojeISO, nomeDiaSemana, deISODate } from "../services/dates.js";
import { irPara } from "./router.js";
import { el, card, botao, tituloVista } from "./components/ui.js";
import { linhaEntrada, sheetSessaoAvulsa, cardResumoSemana } from "./components/agenda-ui.js";
import { cardProteina, cardRefeicoesHoje } from "./components/nutricao-ui.js";
import { cardPeso } from "./components/corpo-ui.js";

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

function cardProximaCorrida(resumo) {
  const w = resumo.proximo;
  if (!w) return null;
  const dias = resumo.diasParaProximo;
  const quando = dias === 1 ? "amanhã" : `em ${dias} dias`;
  return card([
    el("p", { class: "eyebrow", text: "Próxima corrida" }),
    el("div", { class: "mini" }, [
      el("div", { class: "esq" }, [
        el("span", { class: "rotulo", text: `${nomeDiaSemana(w.dataPlanejada)} · ${quando}` }),
        el("strong", { text: w.titulo }),
      ]),
      el("span", { class: "dir", text: `${w.duracaoMin} min · sem. ${w.semana}` }),
    ]),
  ]);
}

export async function renderHoje(container) {
  const data = hojeISO();
  const plan = await repo.planoAtivo();
  const [entradas, semana, resumoCorrida, nutricao, corpo] = await Promise.all([
    carregarDia(data),
    carregarSemana(data),
    plan ? resumoHoje(plan, data) : Promise.resolve(null),
    carregarDiaNutricao(data),
    carregarCorpo(data),
  ]);

  container.appendChild(tituloVista("Hoje"));
  container.appendChild(el("p", { class: "hoje-data", text: dataExtensa(data) }));

  container.appendChild(cardAgenda(entradas, data, resumoCorrida));
  container.appendChild(cardProteina(nutricao));
  container.appendChild(cardRefeicoesHoje(nutricao));
  container.appendChild(cardResumoSemana(semana, { titulo: "Esta semana" }));
  container.appendChild(cardPeso(corpo));

  const temCorridaHoje = entradas.some((e) => e.tipo === "corrida");
  if (resumoCorrida && !temCorridaHoje) {
    const prox = cardProximaCorrida(resumoCorrida);
    if (prox) container.appendChild(prox);
  }

  container.appendChild(botao("Registrar corrida avulsa", { bloco: true, onClick: () => irPara("avulso") }));
}
