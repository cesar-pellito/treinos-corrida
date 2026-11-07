// evolution.js — Evolução: totais, aderência e recordes, depois os gráficos por
// semana com seletor de período 4/8/12/tudo. O número diz a que semana se refere.

import * as repo from "../data/repository.js";
import { semanaAtual } from "../services/schedule.js";
import { seriesSemanais, aderencia, acumulado, recordes, janelaDeSemanas } from "../services/stats.js";
import { recorrenciaTodas } from "../services/discomfort.js";
import { formatarPace, formatarDuracao, formatarDistanciaKm, formatarTempoTotal } from "../services/pace.js";
import { calcularZonasFC, FC_MAXIMA_PADRAO } from "../services/dominio.js";
import { el, card, tituloVista, estadoVazio, segmentos, barraProgresso } from "./components/ui.js";
import { graficoLinha, graficoVolume, graficoAderencia, blocoGrafico } from "./components/charts.js";

const paceSemUnidade = (s) => formatarPace(s).replace(" /km", "");
const rpeComVirgula = (v) => v.toFixed(1).replace(".", ",");

/** Cartão de um gráfico de linha: sem valor no período, explica como preencher. */
function blocoLinha(janela, serieCompleta, atual, campo, { titulo, sub, comoPreencher, ...opcoes }) {
  const comValor = janela.filter((l) => l[campo] != null);
  if (!comValor.length) {
    const nuncaRegistrado = !serieCompleta.some((l) => l[campo] != null);
    return blocoGrafico({ titulo, sub, vazio: nuncaRegistrado ? `Ainda sem dados. ${comoPreencher}` : "Sem dados neste período." });
  }
  const ultimo = comValor[comValor.length - 1];
  return blocoGrafico({
    titulo, sub,
    valor: opcoes.formatar(ultimo[campo]),
    semana: ultimo.semana,
    svg: graficoLinha(janela.map((l) => ({ semana: l.semana, valor: l[campo] })), atual, { descricao: titulo, ...opcoes }),
  });
}

export async function renderEvolucao(container, _param, { embutido = false } = {}) {
  if (!embutido) container.appendChild(tituloVista("Evolução"));
  const plan = await repo.planoAtivo();
  if (!plan) { container.appendChild(estadoVazio("Sem plano ativo")); return; }

  const sAtual = semanaAtual(plan);
  const [serieCompleta, ader, acc, rec, recorr, fcMax] = await Promise.all([
    seriesSemanais(plan),
    aderencia(plan, sAtual),
    acumulado(),
    recordes(),
    recorrenciaTodas(4),
    repo.obterConfig("fcMaxima"),
  ]);

  // Totais e aderência
  container.appendChild(
    card([
      el("div", { class: "evo-totais" }, [
        total(String(acc.treinos), acc.treinos === 1 ? "treino" : "treinos"),
        total(acc.km.toFixed(1).replace(".", ","), "km no total"),
        total(formatarTempoTotal(acc.minutos), "de corrida"),
      ]),
      el("div", { class: "evo-aderencia" }, [
        el("div", { class: "row-between" }, [
          el("span", { class: "strong", text: "Aderência ao plano" }),
          el("span", { class: "grafico__num", text: `${ader.acumuladaPct}%` }),
        ]),
        barraProgresso(ader.acumuladaPct / 100),
        el("span", { class: "grafico__sub", text: `${ader.concluidos} de ${ader.planejados} treinos até a semana ${sAtual}` }),
      ]),
    ])
  );

  // Recordes
  if (rec.maiorDistancia || rec.maiorDuracao || rec.melhorPace) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: "Recordes pessoais" }),
        el("div", { class: "evo-linhas" }, [
          rec.maiorDistancia ? linha("Maior distância", formatarDistanciaKm(rec.maiorDistancia.distanciaMetros)) : null,
          rec.maiorDuracao ? linha("Maior duração", formatarDuracao(rec.maiorDuracao.duracaoSeg)) : null,
          rec.melhorPace ? linha("Melhor pace", formatarPace(rec.melhorPace.paceSegPorKm)) : null,
        ]),
      ])
    );
  }

  // Recorrência de desconforto (factual)
  if (recorr.length) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: "Desconforto · últimos 4 treinos" }),
        ...recorr.map((r) => el("p", { class: "sub", text: r.texto })),
      ])
    );
  }

  // Área de gráficos com seletor de período
  const areaGraficos = el("div", {});
  const sel = segmentos(
    [{ valor: 4, rotulo: "4 sem" }, { valor: 8, rotulo: "8 sem" }, { valor: 12, rotulo: "12 sem" }, { valor: 0, rotulo: "Tudo" }],
    { valorInicial: 8, onChange: () => desenhar(sel.get()) }
  );
  sel.node.classList.add("segmentos--cheio");
  container.appendChild(el("p", { class: "eyebrow evo-periodo", text: "Período dos gráficos" }));
  container.appendChild(sel.node);
  container.appendChild(areaGraficos);

  const zona2 = calcularZonasFC(fcMax || FC_MAXIMA_PADRAO).find((z) => z.codigo === "Z2");

  function desenhar(periodo) {
    const { de, ate } = janelaDeSemanas(sAtual, periodo, plan.totalSemanas || 22);
    const janela = serieCompleta.filter((l) => l.semana >= de && l.semana <= ate);
    const estaSemana = serieCompleta.find((l) => l.semana === sAtual);

    areaGraficos.replaceChildren(
      blocoGrafico({
        titulo: "Volume semanal",
        sub: "Minutos de corrida",
        valor: `${estaSemana.minutos} de ${estaSemana.minutosPlanejados} min`,
        semana: sAtual,
        legenda: [["grafico__chave", "Feito"], ["grafico__chave grafico__chave--plano", "Planejado"]],
        svg: graficoVolume(janela, sAtual),
      }),
      blocoGrafico({
        titulo: "Aderência por semana",
        sub: "Cada quadrado é um treino",
        valor: `${estaSemana.concluidos} de ${estaSemana.planejados}`,
        semana: sAtual,
        svg: graficoAderencia(janela, sAtual),
      }),
      blocoLinha(janela, serieCompleta, sAtual, "paceFacil", {
        titulo: "Pace médio fácil",
        sub: "Para cima é mais rápido",
        comoPreencher: "Preencha distância e tempo ao registrar a corrida.",
        passo: 60,
        inverter: true,
        formatar: formatarPace,
        formatarEixo: paceSemUnidade,
      }),
      blocoLinha(janela, serieCompleta, sAtual, "fcFacil", {
        titulo: "FC média fácil",
        sub: `Meta: Z2, ${zona2.bpm}`,
        comoPreencher: "Preencha a FC média ao registrar a corrida.",
        passo: 10,
        faixa: { de: zona2.bpmMin, ate: zona2.bpmMax, rotulo: "Z2" },
        formatar: (v) => `${Math.round(v)} bpm`,
        formatarEixo: String,
      }),
      blocoLinha(janela, serieCompleta, sAtual, "rpeMedio", {
        titulo: "RPE médio",
        sub: "Meta das semanas fáceis: 3–4",
        comoPreencher: "Marque o esforço ao registrar a corrida.",
        passo: 3,
        dominio: [1, 10],
        faixa: { de: 3, ate: 4, rotulo: "Meta 3–4" },
        formatar: rpeComVirgula,
        formatarEixo: String,
      }),
    );
  }
  desenhar(sel.get());
}

function total(n, r) {
  return el("div", { class: "evo-total" }, [el("span", { class: "evo-total__n", text: n }), el("span", { class: "grafico__sub", text: r })]);
}
function linha(r, v) {
  return el("div", { class: "linha" }, [el("span", { class: "muted", text: r }), el("span", { class: "strong", text: v })]);
}
