// evolution.js — Evolução: KPIs + gráficos SVG. Seletor de período 4/8/12/tudo.
// O número grande é a resposta; o gráfico é o detalhe.

import * as repo from "../data/repository.js";
import { semanaAtual } from "../services/schedule.js";
import { seriesSemanais, aderencia, acumulado, recordes } from "../services/stats.js";
import { recorrenciaTodas } from "../services/discomfort.js";
import { formatarPace, formatarDuracao } from "../services/pace.js";
import { el, card, tituloVista, estadoVazio, segmentos } from "./components/ui.js";
import { graficoLinha, graficoBarras, blocoGrafico } from "./components/charts.js";

function ultimoNaoNulo(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

export async function renderEvolucao(container) {
  container.appendChild(tituloVista("Evolução"));
  const plan = await repo.planoAtivo();
  if (!plan) { container.appendChild(estadoVazio("Sem plano ativo")); return; }

  const sAtual = semanaAtual(plan);
  const [serieCompleta, ader, acc, rec, recorr] = await Promise.all([
    seriesSemanais(plan),
    aderencia(plan, sAtual),
    acumulado(),
    recordes(),
    recorrenciaTodas(4),
  ]);

  // KPIs
  container.appendChild(
    el("div", { class: "kpis" }, [
      kpi(`${ader.acumuladaPct}%`, "Aderência acumulada"),
      kpi(`${acc.minutos} min`, "Volume total"),
      kpi(`${acc.km} km`, "Distância total"),
      kpi(String(acc.treinos), "Treinos registrados"),
    ])
  );

  // Recordes
  if (rec.maiorDistancia || rec.maiorDuracao || rec.melhorPace) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: "Recordes pessoais" }),
        rec.maiorDistancia ? linha("Maior distância", `${(rec.maiorDistancia.distanciaMetros / 1000).toFixed(2).replace(".", ",")} km`) : null,
        rec.maiorDuracao ? linha("Maior duração", formatarDuracao(rec.maiorDuracao.duracaoSeg)) : null,
        rec.melhorPace ? linha("Melhor pace", formatarPace(rec.melhorPace.paceSegPorKm)) : null,
      ])
    );
  }

  // Recorrência de desconforto (factual)
  if (recorr.length) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: "Desconforto — últimos 4 treinos" }),
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
  container.appendChild(sel.node);
  container.appendChild(areaGraficos);

  function desenhar(periodo) {
    const inicio = periodo === 0 ? 1 : Math.max(1, sAtual - periodo + 1);
    const janela = serieCompleta.filter((l) => l.semana >= inicio && l.semana <= sAtual);
    const rotulosX = janela.map((l) => "S" + l.semana);

    const minutos = janela.map((l) => l.minutos || 0);
    const consist = janela.map((l) => (l.aderencia == null ? null : Math.round(l.aderencia * 100)));
    const pace = janela.map((l) => l.paceFacil);
    const fc = janela.map((l) => (l.fcFacil == null ? null : Math.round(l.fcFacil)));
    const rpe = janela.map((l) => (l.rpeMedio == null ? null : Math.round(l.rpeMedio * 10) / 10));

    const ultPace = ultimoNaoNulo(pace);

    areaGraficos.replaceChildren(
      blocoGrafico("Volume semanal (min)", ultimoNaoNulo(minutos), graficoBarras(minutos, { rotulosX })),
      blocoGrafico("Consistência (%)", ultimoNaoNulo(consist), graficoBarras(consist, { rotulosX }), "%"),
      blocoGrafico("Pace médio fácil", ultPace == null ? null : formatarPace(ultPace).replace(" /km", ""), graficoLinha(pace, { rotulosX })),
      blocoGrafico("FC média fácil", ultimoNaoNulo(fc), graficoLinha(fc, { rotulosX }), " bpm"),
      blocoGrafico("RPE médio", ultimoNaoNulo(rpe), graficoLinha(rpe, { rotulosX })),
    );
  }
  desenhar(sel.get());
}

function kpi(n, r) {
  return el("div", { class: "kpi" }, [el("div", { class: "n", text: n }), el("div", { class: "r", text: r })]);
}
function linha(r, v) {
  return el("div", { class: "linha" }, [el("span", { class: "muted", text: r }), el("span", { class: "strong", text: v })]);
}
