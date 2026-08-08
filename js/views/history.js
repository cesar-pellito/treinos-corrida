// history.js — lista cronológica reversa, agrupada por semana, com busca e
// filtro por tipo. Toque abre o comparativo.

import * as repo from "../data/repository.js";
import { irPara } from "./router.js";
import { formatarDuracao, formatarDistanciaKm, formatarPace } from "../services/pace.js";
import { rotuloTipo, TIPOS } from "../services/dominio.js";
import { diffDias, deISODate, nomeDiaSemana } from "../services/dates.js";
import { el, tituloVista, estadoVazio } from "./components/ui.js";

export async function renderHistorico(container) {
  container.appendChild(tituloVista("Histórico"));
  const plan = await repo.planoAtivo();
  const [completed, planned] = await Promise.all([
    repo.listarCompleted(),
    plan ? repo.listarPlanned({ planId: plan.id }) : Promise.resolve([]),
  ]);
  const plannedPorId = new Map(planned.map((w) => [w.id, w]));

  if (!completed.length) {
    container.appendChild(estadoVazio("Nenhum treino registrado", "Seus treinos realizados vão aparecer aqui, agrupados por semana."));
    return;
  }

  const itens = completed.map((c) => {
    const p = c.plannedWorkoutId ? plannedPorId.get(c.plannedWorkoutId) : null;
    const tipo = p ? p.tipo : (c.tipoAvulso || "avulso");
    const semana = p ? p.semana : (plan ? Math.max(1, Math.floor(diffDias(plan.dataInicio, c.data) / 7) + 1) : 0);
    return { c, tipo, semana, titulo: p ? p.titulo : "Treino avulso" };
  });

  // Controles
  const busca = el("input", { type: "text", placeholder: "Buscar…", "aria-label": "Buscar" });
  const filtro = el("select", { "aria-label": "Filtrar por tipo" });
  filtro.appendChild(el("option", { value: "", text: "Todos os tipos" }));
  for (const [v, r] of Object.entries(TIPOS)) filtro.appendChild(el("option", { value: v, text: r }));

  const lista = el("div", {});
  container.appendChild(el("div", { class: "filtros" }, [busca, filtro]));
  container.appendChild(lista);

  function desenhar() {
    const termo = busca.value.trim().toLowerCase();
    const tipo = filtro.value;
    const filtrados = itens.filter((i) => {
      if (tipo && i.tipo !== tipo) return false;
      if (termo) {
        const texto = `${i.titulo} ${i.c.observacoes || ""}`.toLowerCase();
        if (!texto.includes(termo)) return false;
      }
      return true;
    });
    lista.replaceChildren();
    if (!filtrados.length) { lista.appendChild(estadoVazio("Nada encontrado")); return; }

    // agrupa por semana (desc)
    const grupos = new Map();
    for (const i of filtrados) {
      if (!grupos.has(i.semana)) grupos.set(i.semana, []);
      grupos.get(i.semana).push(i);
    }
    for (const semana of [...grupos.keys()].sort((a, b) => b - a)) {
      const g = el("div", { class: "hist-grupo" }, [el("h3", { text: semana ? `Semana ${semana}` : "Avulsos" })]);
      for (const i of grupos.get(semana)) g.appendChild(itemHist(i));
      lista.appendChild(g);
    }
  }

  function itemHist(i) {
    const d = deISODate(i.c.data);
    const dataFmt = `${nomeDiaSemana(i.c.data, true)} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    return el("div", { class: "hist-item", onClick: () => irPara("detalhe/" + i.c.id) }, [
      el("div", {}, [
        el("div", { class: "tipo", text: rotuloTipo(i.tipo) }),
        el("div", { class: "meta", text: `${dataFmt}${i.c.rpe != null ? " · RPE " + i.c.rpe : ""}` }),
      ]),
      el("div", { class: "dir" }, [
        el("div", { class: "strong", text: formatarDistanciaKm(i.c.distanciaMetros) }),
        el("div", { class: "meta", text: `${formatarDuracao(i.c.duracaoSeg)} · ${formatarPace(i.c.paceSegPorKm)}` }),
      ]),
    ]);
  }

  busca.addEventListener("input", desenhar);
  filtro.addEventListener("change", desenhar);
  desenhar();
}
