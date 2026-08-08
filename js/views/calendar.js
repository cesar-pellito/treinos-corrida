// calendar.js — visão de mês e de semana, status por cor, detalhe e ações
// (registrar, reagendar, marcar não realizado). Reagendar preserva dataOriginal.

import * as repo from "../data/repository.js";
import { irPara } from "./router.js";
import { statusEfetivo, remarcarEmpurrando } from "../services/schedule.js";
import {
  hoje as hojeISO, deISODate, paraISODate, somarDias, diaDaSemana,
  inicioDaSemana, nomeDiaSemana,
} from "../services/dates.js";
import { STATUS_ROTULO } from "../services/dominio.js";
import { el, card, botao, tituloVista, abrirSheet, segmentos, toast } from "./components/ui.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DOW_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

export async function renderCalendario(container) {
  const plan = await repo.planoAtivo();
  container.appendChild(tituloVista("Calendário"));
  if (!plan) { container.appendChild(el("p", { class: "sub", text: "Sem plano ativo." })); return; }

  const pds = plan.primeiroDiaSemana ?? 1;
  const estado = { modo: "mes", cursor: hojeISO() };

  const sel = segmentos(
    [{ valor: "mes", rotulo: "Mês" }, { valor: "semana", rotulo: "Semana" }],
    { valorInicial: "mes", onChange: (v) => { estado.modo = v; redesenhar(); } }
  );
  container.appendChild(sel.node);

  const area = el("div", {});
  container.appendChild(area);
  container.appendChild(legenda());

  async function redesenhar() {
    const planned = await repo.listarPlanned({ planId: plan.id });
    const porData = new Map();
    for (const w of planned) {
      if (!porData.has(w.dataPlanejada)) porData.set(w.dataPlanejada, []);
      porData.get(w.dataPlanejada).push(w);
    }
    area.replaceChildren(estado.modo === "mes" ? viewMes(porData) : viewSemana(porData));
  }

  function header(titulo, onPrev, onNext) {
    return el("div", { class: "row-between", style: { marginBottom: "12px" } }, [
      botao("‹", { onClick: onPrev }),
      el("strong", { text: titulo }),
      botao("›", { onClick: onNext }),
    ]);
  }

  function viewMes(porData) {
    const d = deISODate(estado.cursor);
    const ano = d.getFullYear(), mes = d.getMonth();
    const primeiroDoMes = new Date(ano, mes, 1);
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const wrap = el("div", {});
    wrap.appendChild(header(`${MESES[mes]} de ${ano}`,
      () => { estado.cursor = paraISODate(new Date(ano, mes - 1, 1)); redesenhar(); },
      () => { estado.cursor = paraISODate(new Date(ano, mes + 1, 1)); redesenhar(); }));

    const grid = el("div", { class: "cal-grid" });
    // cabeçalho dos dias da semana, respeitando primeiroDiaSemana
    for (let i = 0; i < 7; i++) grid.appendChild(el("div", { class: "cal-dow", text: DOW_CURTO[(pds + i) % 7] }));
    // preenchimento inicial
    const offset = (primeiroDoMes.getDay() - pds + 7) % 7;
    for (let i = 0; i < offset; i++) grid.appendChild(el("div", {}));
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const iso = paraISODate(new Date(ano, mes, dia));
      grid.appendChild(celula(iso, dia, porData.get(iso) || []));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function viewSemana(porData) {
    const inicio = inicioDaSemana(estado.cursor, pds);
    const fim = somarDias(inicio, 6);
    const wrap = el("div", {});
    const fmt = (iso) => { const x = deISODate(iso); return `${x.getDate()}/${x.getMonth() + 1}`; };
    wrap.appendChild(header(`${fmt(inicio)} – ${fmt(fim)}`,
      () => { estado.cursor = somarDias(inicio, -7); redesenhar(); },
      () => { estado.cursor = somarDias(inicio, 7); redesenhar(); }));
    const grid = el("div", { class: "cal-grid" });
    for (let i = 0; i < 7; i++) grid.appendChild(el("div", { class: "cal-dow", text: DOW_CURTO[(pds + i) % 7] }));
    for (let i = 0; i < 7; i++) {
      const iso = somarDias(inicio, i);
      grid.appendChild(celula(iso, deISODate(iso).getDate(), porData.get(iso) || []));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  function celula(iso, numero, treinos) {
    const classes = ["cal-cell"];
    if (iso === hojeISO()) classes.push("cal-cell--hoje");
    if (treinos.some((w) => w.semanaAbsorcao)) classes.push("abs");
    const dots = el("div", { style: { display: "flex", gap: "3px" } },
      treinos.map((w) => el("span", { class: "dot st-" + statusEfetivo(w, hojeISO()) })));
    return el("div", {
      class: classes.join(" "),
      onClick: treinos.length ? () => abrirDetalheDia(iso, treinos) : undefined,
    }, [el("span", { text: String(numero) }), dots]);
  }

  function abrirDetalheDia(iso, treinos) {
    const conteudo = el("div", { class: "stack" });
    for (const w of treinos) conteudo.appendChild(cardDetalhe(w, iso));
    abrirSheet(`${nomeDiaSemana(iso)}, ${deISODate(iso).getDate()}/${deISODate(iso).getMonth() + 1}`, conteudo);
  }

  function cardDetalhe(w, iso) {
    const st = statusEfetivo(w, hojeISO());
    const acoes = el("div", { class: "lista-acoes", style: { marginTop: "10px" } });

    if (st === "concluido") {
      acoes.appendChild(botao("Ver treino", {
        variante: "primary", bloco: true, onClick: async () => {
          const c = await repo.completedPorPlanned(w.id);
          if (c) irPara("detalhe/" + c.id);
        },
      }));
    } else if (st === "perdido") {
      acoes.appendChild(botao("Registrar (fazer agora)", { variante: "primary", bloco: true, onClick: () => irPara("registrar/" + w.id) }));
      acoes.appendChild(botao("Remarcar (empurra o restante do plano)", { bloco: true, onClick: () => remarcar(w) }));
      acoes.appendChild(botao("Marcar como não realizado", {
        bloco: true, onClick: async () => { await repo.marcarStatusPlanned(w.id, "nao_realizado"); fecharERedesenhar(); },
      }));
    } else {
      acoes.appendChild(botao("Registrar", { variante: "primary", bloco: true, onClick: () => irPara("registrar/" + w.id) }));
      acoes.appendChild(botao("Reagendar", { bloco: true, onClick: () => reagendar(w) }));
      if (st !== "nao_realizado") {
        acoes.appendChild(botao("Marcar como não realizado", {
          bloco: true, onClick: async () => { await repo.marcarStatusPlanned(w.id, "nao_realizado"); fecharERedesenhar(); },
        }));
      }
    }

    return card([
      el("p", { class: "eyebrow", text: `Semana ${w.semana} · ${STATUS_ROTULO[st] || st}` }),
      el("h3", { class: "titulo-lg", text: w.titulo }),
      el("p", { class: "sub", text: `${w.descricao} · ${w.duracaoMin} min · RPE ${w.rpeMin}–${w.rpeMax}` }),
      w.dataOriginal ? el("p", { class: "sub", text: `Data original: ${w.dataOriginal}` }) : null,
      acoes,
    ]);
  }

  function reagendar(w) {
    const input = el("input", { type: "date", value: w.dataPlanejada });
    const conteudo = el("div", { class: "stack" }, [
      el("p", { text: `Reagendar “${w.titulo}”.` }),
      w.dataOriginal ? el("p", { class: "sub", text: `Data original preservada: ${w.dataOriginal}` }) : null,
      input,
      botao("Confirmar", {
        variante: "primary", bloco: true, onClick: async () => {
          if (!input.value) return;
          await repo.reagendarPlanned(w.id, input.value);
          fecharERedesenhar();
        },
      }),
    ]);
    abrirSheet("Reagendar", conteudo);
  }

  function remarcar(w) {
    const input = el("input", { type: "date", value: somarDias(hojeISO(), 1) });
    const resultado = el("p", { class: "sub" });
    const conteudo = el("div", { class: "stack" }, [
      el("p", { text: `Remarcar “${w.titulo}” (semana ${w.semana}).` }),
      el("p", { class: "sub", text: "Os treinos pendentes seguintes são empurrados junto, estendendo o fim do plano. Nada já realizado é alterado." }),
      input,
      resultado,
      botao("Confirmar e empurrar o plano", {
        variante: "primary", bloco: true, onClick: async () => {
          if (!input.value) return;
          const r = await remarcarEmpurrando(plan, w, input.value);
          const fim = deISODate(r.novoFim);
          toast(`Plano remarcado. Novo fim: ${String(fim.getDate()).padStart(2, "0")}/${String(fim.getMonth() + 1).padStart(2, "0")}/${fim.getFullYear()}.`);
          fecharERedesenhar();
        },
      }),
    ]);
    abrirSheet("Remarcar", conteudo);
  }

  function fecharERedesenhar() {
    const ov = document.querySelector(".sheet-overlay");
    if (ov) ov.remove();
    redesenhar();
  }

  await redesenhar();
}

function legenda() {
  const itens = [
    ["st-futuro", "Futuro"], ["st-hoje", "Hoje"], ["st-concluido", "Concluído"],
    ["st-perdido", "Perdido"], ["st-nao_realizado", "Não realizado"], ["st-reagendado", "Reagendado"],
  ];
  return el("div", { class: "legenda" }, itens.map(([c, r]) =>
    el("span", {}, [el("i", { class: c }), document.createTextNode(r)])));
}
