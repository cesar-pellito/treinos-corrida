// today.js — tela Hoje. Responde em menos de um segundo: "qual é meu treino de hoje?"
// Três estados legítimos: treino de hoje / treino concluído / dia de descanso.

import * as repo from "../data/repository.js";
import { resumoHoje } from "../services/schedule.js";
import { hoje as hojeISO, nomeDiaSemana } from "../services/dates.js";
import { irPara } from "./router.js";
import {
  el, card, botao, metaItem, blocoEstrutura, barraProgresso, estadoVazio,
} from "./components/ui.js";

function rpeTexto(w) {
  if (w.rpeMin == null) return "—";
  return w.rpeMin === w.rpeMax ? `${w.rpeMin}` : `${w.rpeMin}–${w.rpeMax}`;
}

/** Bloco visual de um treino: metadados + estrutura. */
function detalheTreino(w, { accent } = {}) {
  const metas = el("div", { class: "metarow" }, [
    metaItem("Duração", `${w.duracaoMin} min`),
    metaItem("RPE", rpeTexto(w)),
    w.zonaFC ? metaItem("Zona FC", w.zonaFC) : null,
  ]);
  const estrutura = el("div", { class: "estrutura" }, [
    blocoEstrutura("Aquecimento", w.aquecimento),
    blocoEstrutura("Principal", w.partePrincipal),
    blocoEstrutura("Desaquec.", w.desaquecimento),
  ]);
  return el("div", {}, [
    w.objetivoFisiologico ? el("p", { class: accent ? "" : "sub", text: w.objetivoFisiologico }) : null,
    metas,
    estrutura,
  ]);
}

function cabecalho(w, resumo) {
  const partes = [nomeDiaSemana(w.dataPlanejada), `Semana ${resumo.semana}`];
  if (resumo.fase) partes.push(resumo.fase.nome);
  return partes.join(" · ");
}

function tituloComBadges(w) {
  return el("h2", { class: "titulo-xl" }, w.titulo);
}

function abrirRegistro(w) {
  irPara("registrar/" + w.id);
}

function estadoTreinoHoje(w, resumo) {
  return card(
    [
      el("p", { class: "eyebrow", text: cabecalho(w, resumo) }),
      tituloComBadges(w),
      w.semanaAbsorcao ? el("span", { class: "badge badge--absorcao", text: "Semana de absorção" }) : null,
      detalheTreino(w, { accent: true }),
      el("div", { style: { marginTop: "16px" } }, [
        botao("Registrar treino", { variante: "primary", bloco: true, grande: true, onClick: () => abrirRegistro(w) }),
      ]),
    ],
    { accent: true }
  );
}

function estadoConcluido(w, resumo, compId) {
  return card([
    el("p", { class: "eyebrow", text: cabecalho(w, resumo) }),
    el("div", { class: "row-between" }, [
      el("h2", { class: "titulo-lg", text: w.titulo }),
      el("span", { class: "badge badge--concluido", text: "Concluído" }),
    ]),
    el("p", { class: "sub", text: "Treino de hoje registrado." }),
    botao("Ver resumo", { bloco: true, variante: "primary", onClick: () => compId && irPara("detalhe/" + compId) }),
  ]);
}

function estadoDescanso(resumo) {
  const filhos = [
    el("p", { class: "eyebrow", text: `${nomeDiaSemana(hojeISO())} · Semana ${resumo.semana}${resumo.fase ? " · " + resumo.fase.nome : ""}` }),
    el("h2", { class: "titulo-xl", text: "Hoje é descanso" }),
    el("p", { class: "sub", text: "Descanso é parte do plano — é onde a adaptação acontece." }),
  ];
  if (resumo.proximo) {
    const dias = resumo.diasParaProximo;
    const quando = dias === 1 ? "amanhã" : `em ${dias} dias`;
    filhos.push(
      el("div", { class: "mini", style: { marginTop: "14px" } }, [
        el("div", { class: "esq" }, [
          el("span", { class: "rotulo", text: `Próximo treino · ${quando}` }),
          el("strong", { text: `${nomeDiaSemana(resumo.proximo.dataPlanejada)} — ${resumo.proximo.titulo}` }),
        ]),
        el("span", { class: "dir", text: `${resumo.proximo.duracaoMin} min` }),
      ])
    );
  }
  return card(filhos);
}

function cardProgresso(resumo) {
  const p = resumo.progresso;
  const frac = p.total ? p.feitos / p.total : 0;
  return card([
    el("p", { class: "eyebrow", text: "Progresso da semana" }),
    el("div", { class: "row-between" }, [
      el("span", { class: "strong", text: `${p.feitos} de ${p.total} treinos` }),
      el("span", { class: "muted", text: `${p.minFeitos} de ${p.minTotal} min` }),
    ]),
    el("div", { style: { marginTop: "10px" } }, [barraProgresso(frac)]),
  ]);
}

function cardStreak(resumo) {
  const n = resumo.streak;
  const texto = n === 0
    ? "Comece sua sequência: 2+ treinos numa semana."
    : `${n} ${n === 1 ? "semana seguida" : "semanas seguidas"} com a meta (2+ treinos).`;
  return card([
    el("p", { class: "eyebrow", text: "Sequência" }),
    el("div", { class: "row-between" }, [
      el("span", { class: "numero-grande", text: String(n) }),
      el("span", { class: "muted", style: { textAlign: "right", maxWidth: "60%" }, text: texto }),
    ]),
  ]);
}

function cardAnteriorProximo(resumo) {
  const linhas = [];
  if (resumo.anterior) {
    linhas.push(mini("Treino anterior", resumo.anterior, resumo.anterior.status === "concluido" ? "concluído" : "não registrado"));
  }
  if (resumo.proximo && (!resumo.hoje || resumo.hoje.status === "concluido")) {
    linhas.push(mini("Próximo treino", resumo.proximo, nomeDiaSemana(resumo.proximo.dataPlanejada)));
  }
  if (!linhas.length) return null;
  return card([el("p", { class: "eyebrow", text: "Ao redor" }), el("div", { class: "mini-lista" }, linhas)]);
}

function mini(rotulo, w, direita) {
  return el("div", { class: "mini" }, [
    el("div", { class: "esq" }, [
      el("span", { class: "rotulo", text: rotulo }),
      el("strong", { text: w.titulo }),
    ]),
    el("span", { class: "dir", text: `${direita} · ${w.duracaoMin} min` }),
  ]);
}

export async function renderHoje(container) {
  const plan = await repo.planoAtivo();
  if (!plan) {
    container.appendChild(estadoVazio("Nenhum plano ativo", "Reabra o app para configurar o plano."));
    return;
  }
  const resumo = await resumoHoje(plan);

  const frag = document.createDocumentFragment();

  if (resumo.hoje && resumo.hoje.status !== "concluido") {
    frag.appendChild(estadoTreinoHoje(resumo.hoje, resumo));
  } else if (resumo.hoje && resumo.hoje.status === "concluido") {
    const comp = await repo.completedPorPlanned(resumo.hoje.id);
    frag.appendChild(estadoConcluido(resumo.hoje, resumo, comp ? comp.id : null));
  } else {
    frag.appendChild(estadoDescanso(resumo));
  }

  frag.appendChild(cardProgresso(resumo));
  frag.appendChild(cardStreak(resumo));
  const ap = cardAnteriorProximo(resumo);
  if (ap) frag.appendChild(ap);

  frag.appendChild(botao("Registrar treino avulso", { bloco: true, onClick: () => irPara("avulso") }));

  container.appendChild(frag);
}
