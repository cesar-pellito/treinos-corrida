// workout-detail.js — comparativo planejado × realizado. Deltas em números,
// sem julgamento de valor. Também é o "resumo pós-treino".

import * as repo from "../data/repository.js";
import { irPara, voltar } from "./router.js";
import { formatarDuracao, formatarDistanciaKm, formatarPace } from "../services/pace.js";
import { rotuloSensacao, rotuloRegiao } from "../services/dominio.js";
import { progressoSemana } from "../services/schedule.js";
import { comparacaoSemelhante } from "../services/stats.js";
import { nomeDiaSemana, deISODate } from "../services/dates.js";
import { el, card, botao, cabecalhoVoltar } from "./components/ui.js";

function dataFmt(iso) {
  const d = deISODate(iso);
  return `${nomeDiaSemana(iso)}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function linhaComp(rotulo, valor) {
  return el("div", { class: "linha" }, [el("span", { class: "muted", text: rotulo }), el("span", { class: "strong", text: valor })]);
}

function delta(valor, sufixo = "") {
  if (valor == null) return null;
  const sinal = valor > 0 ? "+" : "";
  const cls = valor === 0 ? "delta" : valor > 0 ? "delta delta--pos" : "delta delta--neg";
  return el("span", { class: cls, text: `${sinal}${valor}${sufixo}` });
}

export async function renderDetalhe(container, { id }) {
  const c = await repo.obterCompleted(id);
  if (!c) throw new Error("Treino não encontrado.");
  const planned = c.plannedWorkoutId ? await repo.obterPlanned(c.plannedWorkoutId) : null;
  const desconfortos = await repo.listarDesconfortosPorTreino(id);

  container.appendChild(cabecalhoVoltar("Treino", voltar));

  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: dataFmt(c.data) + (planned ? ` · Semana ${planned.semana}` : " · Avulso") }),
      el("h2", { class: "titulo-lg", text: planned ? planned.titulo : "Treino avulso" }),
    ])
  );

  const realMin = c.duracaoSeg != null ? Math.round(c.duracaoSeg / 60) : null;

  // Comparativo
  if (planned) {
    const colPlan = el("div", { class: "col" }, [
      el("h4", { text: "Planejado" }),
      linhaComp("Duração", `${planned.duracaoMin} min`),
      linhaComp("RPE", `${planned.rpeMin}–${planned.rpeMax}`),
      linhaComp("Zona FC", planned.zonaFC || "—"),
    ]);
    const colReal = el("div", { class: "col" }, [
      el("h4", { text: "Realizado" }),
      linhaComp("Duração", realMin != null ? `${realMin} min` : "—"),
      linhaComp("RPE", c.rpe != null ? String(c.rpe) : "—"),
      linhaComp("FC média", c.fcMedia != null ? `${c.fcMedia} bpm` : "—"),
    ]);
    container.appendChild(el("div", { class: "comp" }, [colPlan, colReal]));

    // Deltas
    const dDur = realMin != null ? realMin - planned.duracaoMin : null;
    const rpeMid = (planned.rpeMin + planned.rpeMax) / 2;
    const dRpe = c.rpe != null ? Math.round((c.rpe - rpeMid) * 10) / 10 : null;
    const deltas = el("div", { class: "metarow", style: { marginTop: "12px" } }, [
      el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Δ Duração" }), delta(dDur, " min") || el("span", { class: "valor", text: "—" })]),
      el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Δ RPE" }), delta(dRpe) || el("span", { class: "valor", text: "—" })]),
    ]);
    container.appendChild(card([el("p", { class: "eyebrow", text: "Diferença" }), deltas]));
  }

  // Números do realizado
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Registro" }),
      el("div", { class: "metarow" }, [
        el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Distância" }), el("span", { class: "valor", text: formatarDistanciaKm(c.distanciaMetros) })]),
        el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Tempo" }), el("span", { class: "valor", text: formatarDuracao(c.duracaoSeg) })]),
        el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Pace" }), el("span", { class: "valor", text: formatarPace(c.paceSegPorKm) })]),
        c.rpe != null ? el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "RPE" }), el("span", { class: "valor", text: String(c.rpe) })]) : null,
        c.sensacao ? el("div", { class: "metaitem" }, [el("span", { class: "rotulo", text: "Sensação" }), el("span", { class: "valor", text: rotuloSensacao(c.sensacao) })]) : null,
      ]),
      c.observacoes ? el("p", { class: "sub", style: { marginTop: "8px" }, text: c.observacoes }) : null,
    ])
  );

  // Comparação com treino semelhante (ÚTIL)
  try {
    const comp = await comparacaoSemelhante(c);
    if (comp) container.appendChild(card([el("p", { class: "eyebrow", text: "Comparação" }), el("p", { text: comp.texto })]));
  } catch { /* comparação é acessório */ }

  // Desconfortos
  if (desconfortos.length) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: "Desconforto registrado" }),
        ...desconfortos.map((d) => el("div", { class: "linha" }, [
          el("span", { text: rotuloRegiao(d.regiao) }),
          el("span", { class: "strong", text: `${d.intensidade ?? "—"}/10${d.observacao ? " · " + d.observacao : ""}` }),
        ])),
      ])
    );
  }

  // Progresso da semana (resumo pós-treino)
  if (planned) {
    const plan = await repo.planoAtivo();
    if (plan) {
      const todos = await repo.listarPlanned({ planId: plan.id });
      const p = progressoSemana(todos, planned.semana);
      container.appendChild(
        card([
          el("p", { class: "eyebrow", text: `Progresso da semana ${planned.semana}` }),
          el("div", { class: "row-between" }, [
            el("span", { class: "strong", text: `${p.feitos} de ${p.total} treinos` }),
            el("span", { class: "muted", text: `${p.minFeitos} de ${p.minTotal} min` }),
          ]),
        ])
      );
    }
  }

  container.appendChild(botao("Editar treino", { bloco: true, onClick: () => irPara("editar/" + c.id) }));
}
