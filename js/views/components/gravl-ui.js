// gravl-ui.js — importação do CSV do Gravl e os cards de séries por grupo e
// 1RM estimado (Treinos → Semana).

import {
  importarCSV, carregarResumoGravl, salvarExerciciosPrincipais, GRUPOS, GRUPOS_PERNA,
} from "../../services/gravl.js";
import { deISODate } from "../../services/dates.js";
import { recarregar, irPara } from "../router.js";
import { el, card, botao, abrirSheet, toast, barraProgresso } from "./ui.js";
import { graficoLinha, blocoGrafico } from "./charts.js";

const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const ddmmaa = (iso) => `${ddmm(iso)}/${iso.slice(0, 4)}`;
const fmt1 = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

// ---------------------------------------------------------------------------
// Importação (Ajustes)
// ---------------------------------------------------------------------------
export function botaoImportarGravl() {
  const input = el("input", { type: "file", accept: ".csv,text/csv,text/plain", style: { display: "none" } });
  const b = botao("Importar CSV do Gravl", { variante: "primary", bloco: true, onClick: () => input.click() });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    b.disabled = true;
    b.textContent = "Importando…";
    try {
      const rel = await importarCSV(await file.text());
      mostrarRelatorio(rel);
    } catch (e) {
      toast("Falha ao importar: " + (e && e.message), 5000);
    } finally {
      b.disabled = false;
      b.textContent = "Importar CSV do Gravl";
    }
  });
  return el("div", {}, [b, input]);
}

function mostrarRelatorio(r) {
  const s = r.sessoes;
  const fechar = abrirSheet("Importação do Gravl", el("div", { class: "stack" }, [
    el("p", { class: "strong", text: `${r.novos} treino(s) novo(s) · ${r.atualizados} atualizado(s) · ${r.iguais} igual(is)` }),
    el("p", { class: "sub", text: `${r.totalSeries} séries, de ${ddmmaa(r.de)} a ${ddmmaa(r.ate)}. Reimportar o mesmo arquivo não duplica nada.` }),
    el("p", { class: "sub", text: [
      s.data ? `${s.data} marcada(s) na agenda no próprio dia` : null,
      s.semana ? `${s.semana} remanejada(s) para outro dia da semana` : null,
      s.avulsa ? `${s.avulsa} fora da agenda` : null,
      s.ja_ligado ? `${s.ja_ligado} já estavam ligadas` : null,
    ].filter(Boolean).join(" · ") || "Nenhuma sessão nova na agenda." }),
    ...r.avisos.map((a) => el("p", { class: "avisos", text: a })),
    r.semGrupo.length
      ? el("div", { class: "observacao" }, [
          el("p", { class: "strong", text: `Exercícios sem grupo (${r.semGrupo.length}):` }),
          el("p", { text: r.semGrupo.join(", ") }),
          el("p", { class: "pequeno", text: "Não entram nas metas de perna. Para classificá-los, acrescente um termo em js/data/grupos-musculares.js." }),
        ])
      : null,
    botao("Ver séries da semana", { variante: "primary", bloco: true, onClick: () => { fechar(); irPara("treinos/semana"); } }),
  ]));
}

// ---------------------------------------------------------------------------
// Cards (Treinos → Semana)
// ---------------------------------------------------------------------------

/** Séries de trabalho da semana por grupo, com as metas de perna. */
export async function cardsGravl(dataRef) {
  const g = await carregarResumoGravl(dataRef);
  if (!g.temDados) {
    return [card([
      el("p", { class: "eyebrow", text: "Séries de perna" }),
      el("p", { class: "sub", text: "Importe o CSV do Gravl em Ajustes para ver as séries semanais por grupo muscular e o 1RM estimado." }),
      botao("Ir para Ajustes", { variante: "ghost", onClick: () => irPara("ajustes") }),
    ])];
  }
  const metaDe = { quadriceps: g.metas.quadriceps, posteriorGluteo: g.metas.posteriorGluteo, panturrilha: g.metas.panturrilha };
  const linhasPerna = GRUPOS_PERNA.map((k) => {
    const n = g.porGrupo[k], meta = metaDe[k] || 0;
    return el("div", { class: "serie-grupo" }, [
      el("div", { class: "row-between" }, [
        el("span", { class: "strong", text: GRUPOS[k] }),
        el("span", { class: n >= meta ? "ok-txt strong" : "muted", text: `${n} de ${meta}` }),
      ]),
      barraProgresso(meta ? n / meta : 0),
    ]);
  });
  const outros = Object.keys(GRUPOS).filter((k) => !GRUPOS_PERNA.includes(k) && g.porGrupo[k] > 0);

  const cards = [card([
    el("p", { class: "eyebrow", text: `Séries de trabalho · ${ddmm(g.inicio)} a ${ddmm(g.fim)}` }),
    el("div", { class: "stack" }, linhasPerna),
    outros.length
      ? el("p", { class: "sub pequeno", style: { marginTop: "12px" }, text: outros.map((k) => `${GRUPOS[k]} ${g.porGrupo[k]}`).join(" · ") })
      : null,
    el("p", { class: "sub pequeno", text: `${g.treinosNaSemana} treino(s) do Gravl na semana · aquecimento não conta · último importado: ${g.ultimo ? ddmmaa(g.ultimo) : "—"}` }),
  ])];

  // 1RM estimado
  const blocos = g.tendencias.map((t) => {
    const ult = t.pontos.length ? t.pontos[t.pontos.length - 1].e1rm : null;
    const svg = graficoLinha(t.pontos.map((p) => p.e1rm), { rotulosX: t.pontos.map((p) => ddmm(p.data)) });
    return blocoGrafico(t.exercicio, ult == null ? null : fmt1(ult), svg, " kg");
  });
  cards.push(card([
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "1RM estimado (Epley)" }),
      el("button", { type: "button", class: "link-sutil", text: "Escolher exercícios", onClick: () => sheetPrincipais(g) }),
    ]),
    ...blocos,
    el("p", { class: "sub pequeno", text: "Estimativa pela fórmula de Epley (peso × (1 + reps/30)), usando a melhor série de trabalho de cada treino." }),
  ]));
  return cards;
}

function sheetPrincipais(g) {
  const escolhidos = new Set(g.principais);
  const chips = g.exercicios.slice(0, 40).map((ex) =>
    el("button", {
      type: "button", class: "chip", text: ex, "aria-pressed": escolhidos.has(ex),
      onClick: (ev) => {
        if (escolhidos.has(ex)) escolhidos.delete(ex); else escolhidos.add(ex);
        ev.currentTarget.setAttribute("aria-pressed", String(escolhidos.has(ex)));
      },
    }));
  const fechar = abrirSheet("Exercícios do 1RM", el("div", { class: "stack" }, [
    el("p", { class: "sub", text: "Os mais frequentes no seu Gravl. Escolha quais acompanhar." }),
    el("div", { class: "chips" }, chips),
    botao("Salvar", {
      variante: "primary", bloco: true, onClick: async () => {
        await salvarExerciciosPrincipais([...escolhidos]);
        fechar();
        recarregar();
      },
    }),
  ]));
}
