// agenda-ui.js — linhas da agenda com check de 1 toque, folhas de detalhe e o
// card de resumo da semana. Usado na tela Hoje e em Treinos → Semana.

import * as repo from "../../data/repository.js";
import { irPara, recarregar } from "../router.js";
import {
  ROTULO_TIPO, ROTULO_PERIODO, ROTULO_STATUS, ROTULOS_SUGERIDOS,
  alternarSessao, marcarSessao, editarSessao, desmarcarSessao,
  alternarCorridaNaoFeita, registrarSessaoAvulsa,
} from "../../services/agenda.js";
import { hoje as hojeISO, nomeDiaSemana, deISODate } from "../../services/dates.js";
import { el, botao, abrirSheet, seletorBotoes, segmentos, toast, campo, barraProgresso, metaItem, blocoEstrutura } from "./ui.js";

const ICONE = { feito: "✓", nao_feito: "✕", pulado: "↷" };
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const naDia = (d) => (d === "sábado" || d === "domingo" ? "no " : "na ") + d;
const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Executa a ação, avisa se falhar e redesenha a tela mantendo o scroll. */
async function agir(fn) {
  try { await fn(); }
  catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
  await recarregar();
}

/** Grupo de botões de status. `acoes` = {feito, nao_feito, pulado} → handler; ausentes não aparecem. */
function botoesStatus(atual, acoes) {
  const wrap = el("div", { class: "check3", role: "group", "aria-label": "Marcar" });
  for (const st of ["feito", "nao_feito", "pulado"]) {
    if (!acoes[st]) continue;
    wrap.appendChild(el("button", {
      type: "button", class: `check3__op check3__op--${st}`, text: ICONE[st],
      "aria-pressed": atual === st, "aria-label": ROTULO_STATUS[st], title: ROTULO_STATUS[st],
      onClick: (ev) => { ev.currentTarget.disabled = true; acoes[st](); },
    }));
  }
  return wrap;
}

function tituloSessao(tipo, rotulo) {
  return rotulo ? `${ROTULO_TIPO[tipo] || tipo} — ${rotulo}` : (ROTULO_TIPO[tipo] || tipo);
}

function detalhesLog(log) {
  if (!log) return null;
  const partes = [ROTULO_STATUS[log.status]];
  if (log.duracaoMin) partes.push(`${log.duracaoMin} min`);
  if (log.rpe) partes.push(`RPE ${log.rpe}`);
  return partes.join(" · ");
}

function linha({ periodo, titulo, sub, status, onTitulo, controles, extra }) {
  const esq = el("button", { type: "button", class: "agenda-linha__info", onClick: onTitulo }, [
    el("span", { class: "agenda-linha__periodo", text: ROTULO_PERIODO[periodo] || "" }),
    el("span", { class: "agenda-linha__titulo", text: titulo }),
    sub ? el("span", { class: "agenda-linha__sub", text: sub }) : null,
  ]);
  return el("div", { class: `agenda-linha${status ? " agenda-linha--" + status : ""}` }, [
    el("div", { class: "agenda-linha__topo" }, [esq, controles]),
    extra || null,
  ]);
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

/** Uma entrada de `montarDia` como linha clicável. */
export function linhaEntrada(entrada, data, { resumoCorrida } = {}) {
  if (entrada.tipo === "sessao") return linhaSessao(entrada, data);
  if (entrada.tipo === "corrida") return linhaCorrida(entrada, resumoCorrida);
  return linhaAvulsa(entrada);
}

function linhaSessao({ item, log, periodo, remanejado }, data) {
  const atual = log ? log.status : null;
  const acao = (st) => () => agir(() => alternarSessao(item, data, st, log));
  return linha({
    periodo,
    titulo: tituloSessao(item.tipo, item.rotulo) + (item.opcional ? " (opcional)" : ""),
    sub: remanejado ? `Feito ${naDia(nomeDiaSemana(remanejado.data))} (${ddmm(remanejado.data)})` : detalhesLog(log),
    status: atual || (remanejado ? "remanejado" : null),
    onTitulo: () => sheetSessao({ item, data, log }),
    controles: botoesStatus(atual, { feito: acao("feito"), nao_feito: acao("nao_feito"), pulado: acao("pulado") }),
  });
}

function linhaAvulsa({ log, periodo, item, credita }) {
  const origem = credita && item ? `Vale pelo treino de ${NOMES_DIA[item.diaSemana]}` : "Fora da agenda";
  return linha({
    periodo,
    titulo: tituloSessao(log.tipo, log.rotulo),
    sub: origem + " · " + detalhesLog(log),
    status: log.status,
    onTitulo: () => sheetSessao({ log, data: log.data, avulsa: true }),
    controles: botoesStatus(log.status, { feito: () => agir(() => desmarcarSessao(log)) }),
  });
}

function linhaCorrida({ planned: w, periodo }, resumoCorrida) {
  const concluido = w.status === "concluido";
  const naoFeito = w.status === "nao_realizado";
  const atual = concluido ? "feito" : naoFeito ? "nao_feito" : null;
  const partes = [`${w.duracaoMin} min`];
  if (w.rpeMin != null) partes.push(`RPE ${w.rpeMin === w.rpeMax ? w.rpeMin : w.rpeMin + "–" + w.rpeMax}`);
  partes.push(`Semana ${w.semana}`);
  if (concluido) partes.unshift("Feito");
  if (naoFeito) partes.unshift("Não realizado");

  const detalhe = el("div", { class: "agenda-linha__detalhe hidden" }, [
    w.objetivoFisiologico ? el("p", { class: "sub", text: w.objetivoFisiologico }) : null,
    el("div", { class: "metarow" }, [
      metaItem("Duração", `${w.duracaoMin} min`),
      w.zonaFC ? metaItem("Zona FC", w.zonaFC) : null,
      resumoCorrida && resumoCorrida.fase ? metaItem("Fase", resumoCorrida.fase.nome) : null,
    ]),
    el("div", { class: "estrutura" }, [
      blocoEstrutura("Aquecimento", w.aquecimento),
      blocoEstrutura("Principal", w.partePrincipal),
      blocoEstrutura("Desaquec.", w.desaquecimento),
    ]),
    w.semanaAbsorcao ? el("span", { class: "badge badge--absorcao", text: "Semana de absorção" }) : null,
    !concluido && !naoFeito
      ? botao("Registrar corrida", { variante: "primary", bloco: true, onClick: () => irPara("registrar/" + w.id) })
      : null,
  ]);

  const abrirRegistro = async () => {
    if (concluido) {
      const comp = await repo.completedPorPlanned(w.id);
      if (comp) irPara("detalhe/" + comp.id);
    } else {
      irPara("registrar/" + w.id);
    }
  };

  return linha({
    periodo,
    titulo: `Corrida — ${w.titulo}`,
    sub: partes.join(" · "),
    status: atual,
    onTitulo: () => detalhe.classList.toggle("hidden"),
    controles: botoesStatus(atual, {
      feito: abrirRegistro,
      nao_feito: () => agir(() => alternarCorridaNaoFeita(w)),
    }),
    extra: detalhe,
  });
}

// ---------------------------------------------------------------------------
// Folhas (bottom sheets)
// ---------------------------------------------------------------------------

const OPCOES_RPE = Array.from({ length: 10 }, (_, i) => ({ valor: i + 1, rotulo: String(i + 1) }));

function inputMinutos(valor) {
  return el("input", {
    type: "number", id: "sess-min", inputmode: "numeric", min: "0", step: "1",
    placeholder: "opcional", value: valor ?? "",
  });
}
const lerMinutos = (input) => (input.value ? Math.max(0, Math.round(Number(input.value))) : null);

/** Detalhe de uma sessão: status, duração e RPE opcionais. */
function sheetSessao({ item, data, log, avulsa }) {
  const titulo = item ? tituloSessao(item.tipo, item.rotulo) : tituloSessao(log.tipo, log.rotulo);
  const status = avulsa ? null : segmentos(
    [{ valor: "feito", rotulo: "Feito" }, { valor: "nao_feito", rotulo: "Não feito" }, { valor: "pulado", rotulo: "Pulado" }],
    { valorInicial: log ? log.status : "feito" }
  );
  const min = inputMinutos(log && log.duracaoMin);
  const rpe = seletorBotoes(OPCOES_RPE, { valorInicial: log ? log.rpe : null, colunas: 5 });

  const salvar = botao("Salvar", {
    variante: "primary", bloco: true, onClick: async () => {
      salvar.disabled = true;
      const campos = { duracaoMin: lerMinutos(min), rpe: rpe.get() };
      fechar();
      await agir(() => (avulsa
        ? editarSessao(log, campos)
        : marcarSessao(item, data, status.get(), campos)));
    },
  });
  const remover = log
    ? botao("Remover registro", { variante: "ghost", bloco: true, onClick: async () => { fechar(); await agir(() => desmarcarSessao(log)); } })
    : null;

  const fechar = abrirSheet(titulo, el("div", { class: "stack" }, [
    status ? status.node : null,
    campo("Duração (min)", min),
    el("div", { class: "campo" }, [el("label", { text: "RPE (opcional)" }), rpe.node]),
    el("div", { class: "lista-acoes" }, [salvar, remover]),
  ]));
}

/** Sessão fora da agenda: musculação ou karatê num dia qualquer. */
export function sheetSessaoAvulsa(dataInicial = hojeISO()) {
  let tipo = "musculacao";
  const inData = el("input", { type: "date", id: "av-data", value: dataInicial });
  const inRotulo = el("input", { type: "text", id: "av-rotulo", placeholder: "ou escreva um rótulo" });
  const caixaRotulos = el("div", {});
  let rotulos;
  function desenharRotulos() {
    const ops = ROTULOS_SUGERIDOS[tipo].map((r) => ({ valor: r, rotulo: r }));
    rotulos = seletorBotoes(ops, { valorInicial: ops[0].valor, onChange: () => { inRotulo.value = ""; } });
    caixaRotulos.replaceChildren(rotulos.node);
  }
  const tipoSel = segmentos(
    [{ valor: "musculacao", rotulo: "Musculação" }, { valor: "karate", rotulo: "Karatê" }],
    { valorInicial: tipo, onChange: (v) => { tipo = v; desenharRotulos(); } }
  );
  desenharRotulos();
  const periodo = segmentos([{ valor: "manha", rotulo: "Manhã" }, { valor: "noite", rotulo: "Noite" }], { valorInicial: "manha" });
  const min = inputMinutos(null);
  const rpe = seletorBotoes(OPCOES_RPE, { colunas: 5 });
  const erro = el("p", { class: "erro" });

  const salvar = botao("Registrar como feito", {
    variante: "primary", bloco: true, onClick: async () => {
      if (!inData.value) { erro.textContent = "Escolha a data."; return; }
      const rotulo = inRotulo.value.trim() || rotulos.get();
      salvar.disabled = true;
      fechar();
      await agir(() => registrarSessaoAvulsa({
        data: inData.value, tipo, rotulo, periodo: periodo.get(), duracaoMin: lerMinutos(min), rpe: rpe.get(),
      }));
    },
  });

  const fechar = abrirSheet("Treino fora da agenda", el("div", { class: "stack" }, [
    tipoSel.node,
    campo("Data", inData),
    el("div", { class: "campo" }, [el("label", { text: "Rótulo" }), caixaRotulos, inRotulo]),
    periodo.node,
    campo("Duração (min)", min),
    el("div", { class: "campo" }, [el("label", { text: "RPE (opcional)" }), rpe.node]),
    erro,
    salvar,
  ]));
}

// ---------------------------------------------------------------------------
// Card de resumo da semana
// ---------------------------------------------------------------------------

export function cardResumoSemana(r, { titulo = "Semana" } = {}) {
  const lowerOk = r.lower >= r.metaLower;
  const detalhes = [];
  if (r.pulados) detalhes.push(`${r.pulados} pulado${r.pulados > 1 ? "s" : ""}`);
  if (r.naoFeitos) detalhes.push(`${r.naoFeitos} não feito${r.naoFeitos > 1 ? "s" : ""}`);
  if (r.extras) detalhes.push(`+${r.extras} extra${r.extras > 1 ? "s" : ""}`);
  return el("section", { class: "card" }, [
    el("p", { class: "eyebrow", text: titulo }),
    el("div", { class: "semana-resumo" }, [
      el("div", { class: `semana-resumo__lower${lowerOk ? " ok" : ""}` }, [
        el("span", { class: "rotulo", text: "Lower" }),
        el("span", { class: "numero-grande", text: `${r.lower}` }),
        el("span", { class: "muted", text: `de ${r.metaLower}` }),
      ]),
      el("div", { class: "semana-resumo__ader" }, [
        el("span", { class: "rotulo", text: "Treinos da semana" }),
        el("span", { class: "strong", text: `${r.feitos} de ${r.previstos}` }),
        barraProgresso(r.previstos ? r.feitos / r.previstos : 0),
        detalhes.length ? el("span", { class: "muted pequeno", text: detalhes.join(" · ") }) : null,
      ]),
    ]),
  ]);
}
