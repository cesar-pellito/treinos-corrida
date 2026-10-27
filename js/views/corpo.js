// corpo.js — aba Corpo: resumo do peso, gráfico com média 7d e InBody, ritmo
// semanal contra a faixa-alvo, avaliações InBody e pesagens recentes.

import { carregarCorpo } from "../services/corpo.js";
import { hoje as hojeISO, somarDias } from "../services/dates.js";
import { el, card, botao, tituloVista, segmentos } from "./components/ui.js";
import { graficoPeso, graficoRitmo } from "./components/charts.js";
import { sheetPesagem, sheetInBody, fmtKg, ddmm, textoRitmo } from "./components/corpo-ui.js";

const PERIODOS = [
  { valor: 30, rotulo: "30 dias" },
  { valor: 90, rotulo: "90 dias" },
  { valor: 0, rotulo: "Tudo" },
];
let periodo = 90; // sobrevive a recarregar()

function kpi(n, r) {
  return el("div", { class: "kpi" }, [el("div", { class: "n", text: n }), el("div", { class: "r", text: r })]);
}

function delta(atual, anterior, { casas = 1, unidade = "" } = {}) {
  if (anterior == null || atual == null) return "";
  const d = atual - anterior;
  if (Math.abs(d) < 0.05) return " (=)";
  return ` (${d > 0 ? "+" : "−"}${fmtKg(Math.abs(d), casas)}${unidade})`;
}

export async function renderCorpo(container) {
  const hoje = hojeISO();
  const c = await carregarCorpo(hoje);
  container.appendChild(tituloVista("Corpo"));

  // ---- resumo ----
  container.appendChild(card([
    el("div", { class: "kpis" }, [
      kpi(c.ultima ? `${fmtKg(c.ultima.pesoKg)} kg` : "—", c.ultima ? `última pesagem · ${ddmm(c.ultima.data)}` : "sem pesagens"),
      kpi(c.media7 == null ? "—" : `${fmtKg(c.media7)} kg`, "média de 7 dias"),
      kpi(c.ritmo ? textoRitmo(c.ritmo.kgSemana) : "—", `faixa ${fmtKg(c.metas.ritmoMinKgSem)}–${fmtKg(c.metas.ritmoMaxKgSem)} kg/sem${c.situacao ? " · " + c.situacao : ""}`),
      kpi(c.faltamKg == null ? "—" : `${fmtKg(Math.max(0, c.faltamKg))} kg`, `até o alvo de ${fmtKg(c.metas.pesoAlvoKg)} kg`),
    ]),
    el("div", { class: "lista-acoes par-acoes" }, [
      botao("+ Pesagem", { variante: "primary", bloco: true, onClick: () => sheetPesagem({ ultimoPeso: c.ultima && c.ultima.pesoKg }) }),
      botao("+ InBody", { bloco: true, onClick: () => sheetInBody() }),
    ]),
  ]));

  // ---- gráfico de peso ----
  const datas = [...c.serie.map((p) => p.data), ...c.inbody.map((p) => p.data)].sort();
  const deTudo = datas.length ? datas[0] : somarDias(hoje, -30);
  const seletor = segmentos(PERIODOS, { valorInicial: periodo, onChange: (v) => { periodo = v; desenharGrafico(); } });
  const caixa = el("div", { class: "grafico" });
  function desenharGrafico() {
    const ini = periodo ? somarDias(hoje, -periodo) : deTudo;
    caixa.replaceChildren(graficoPeso({
      pontos: c.serie, media: c.comMedia, inbody: c.inbody, alvo: c.metas.pesoAlvoKg, de: ini < hoje ? ini : somarDias(hoje, -1), ate: hoje,
    }));
  }
  desenharGrafico();
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Peso" }),
    seletor.node,
    caixa,
    el("div", { class: "legenda" }, [
      el("span", {}, [el("i", { class: "leg-ponto" }), "pesagem do dia"]),
      el("span", {}, [el("i", { class: "leg-linha" }), "média 7 dias"]),
      el("span", {}, [el("i", { class: "leg-inbody" }), "InBody"]),
      el("span", {}, [el("i", { class: "leg-alvo" }), "alvo"]),
    ]),
  ]));

  // ---- ritmo semanal ----
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Ritmo semanal (perda em kg)" }),
    el("div", { class: "grafico" }, [graficoRitmo({ semanas: c.historico, faixa: [c.metas.ritmoMinKgSem, c.metas.ritmoMaxKgSem] })]),
    el("p", { class: "sub pequeno", text: "Cada barra: média de 7 dias no fim da semana menos a média de 7 dias uma semana antes. A faixa sombreada é a que você configurou em Metas." }),
  ]));

  // ---- InBody ----
  const ib = [...c.inbody].reverse();
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "InBody (referência)" }),
    ib.length
      ? el("div", { class: "mini-lista" }, ib.map((m, i) => {
          const ant = ib[i + 1];
          return el("button", { type: "button", class: "mini inbody-item", onClick: () => sheetInBody({ medida: m }) }, [
            el("div", { class: "esq" }, [
              el("span", { class: "rotulo", text: ddmm(m.data) + "/" + m.data.slice(0, 4) }),
              el("strong", { text: `${fmtKg(m.pesoKg)} kg${delta(m.pesoKg, ant && ant.pesoKg)}` }),
              el("span", { class: "pequeno muted", text:
                `gordura ${fmtKg(m.massaGorduraKg)} kg${delta(m.massaGorduraKg, ant && ant.massaGorduraKg)} · ${fmtKg(m.gorduraPct)}%` }),
              el("span", { class: "pequeno muted", text:
                `massa livre de gordura ${fmtKg(m.massaLivreGorduraKg)} kg${delta(m.massaLivreGorduraKg, ant && ant.massaLivreGorduraKg)} · músculo esquelético ${fmtKg(m.massaMuscularEsqueleticaKg)} kg${delta(m.massaMuscularEsqueleticaKg, ant && ant.massaMuscularEsqueleticaKg)}` }),
            ]),
          ]);
        }))
      : el("p", { class: "sub", text: "Nenhuma avaliação." }),
  ]));

  // ---- pesagens recentes ----
  const recentes = [...c.pesagens].reverse().slice(0, 14);
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Pesagens recentes" }),
    recentes.length
      ? el("div", { class: "mini-lista" }, recentes.map((m) =>
          el("button", { type: "button", class: "mini", onClick: () => sheetPesagem({ medida: m }) }, [
            el("div", { class: "esq" }, [
              el("span", { class: "rotulo", text: ddmm(m.data) }),
              el("strong", { text: `${fmtKg(m.pesoKg)} kg` }),
            ]),
            el("span", { class: "dir", text: [m.gorduraPct != null ? `${fmtKg(m.gorduraPct)}% gordura` : null, m.massaMuscularKg != null ? `${fmtKg(m.massaMuscularKg)} kg músc.` : null].filter(Boolean).join(" · ") }),
          ])))
      : el("p", { class: "sub", text: "Registre a primeira pesagem com “+ Pesagem”." }),
  ]));

  container.appendChild(el("p", { class: "sub pequeno", text: "Média de 7 dias: média das pesagens dos últimos 7 dias (vários registros no mesmo dia viram a média do dia). As InBody são referência e não entram na média. O app só mostra números contra as metas que você configurou." }));
}
