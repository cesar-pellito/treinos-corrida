// agenda-ui.js — linhas da agenda com check de 1 toque, folhas de detalhe e o
// card de resumo da semana. Usado na tela Hoje e em Treinos → Semana.

import * as repo from "../../data/repository.js";
import { irPara, recarregar } from "../router.js";
import {
  ROTULO_TIPO, ROTULO_PERIODO, ROTULO_STATUS, ROTULOS_SUGERIDOS, rotuloPeriodoNoDia,
  alternarSessao, marcarSessao, editarSessao, desmarcarSessao,
  alternarCorridaNaoFeita, registrarSessaoAvulsa, voltarAoPrevisto, podeMover,
} from "../../services/agenda.js";
import { corridaFeita, textoZonaFC } from "../../services/dominio.js";
import { alternarCombinada, avisoDiaSeguinte } from "../../services/merge.js";
import { hoje as hojeISO, nomeDiaSemana, deISODate } from "../../services/dates.js";
import { el, botao, abrirSheet, seletorBotoes, segmentos, toast, campo, barraProgresso, metaItem, blocoEstrutura } from "./ui.js";
import { sheetCombinada, sheetMover } from "./merge-ui.js";

const ICONE = { feito: "✓", nao_feito: "✕" };
const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const naDia = (d) => (d === "sábado" || d === "domingo" ? "no " : "na ") + d;
const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Executa a ação, avisa se falhar e redesenha a tela mantendo o scroll. */
export async function agir(fn) {
  try { await fn(); }
  catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
  await recarregar();
}

/** Grupo de botões de status. `acoes` = {feito, nao_feito} → handler; ausentes não aparecem. */
export function botoesStatus(atual, acoes) {
  const wrap = el("div", { class: "check3", role: "group", "aria-label": "Marcar" });
  for (const st of ["feito", "nao_feito"]) {
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

/** "Movido de segunda" / "Movido da manhã"; null se só mudou a posição no período. */
function textoMovido(mov, item, data) {
  if (!mov) return null;
  if (mov.dataOrigem !== data) return `Movido de ${nomeDiaSemana(mov.dataOrigem)}`;
  if (mov.periodo !== item.periodo) return `Movido da ${ROTULO_PERIODO[item.periodo].toLowerCase()}`;
  return null;
}

function linha({ periodo, data, titulo, sub, status, onTitulo, controles, extra, movido }) {
  const esq = el("button", { type: "button", class: "agenda-linha__info", onClick: onTitulo }, [
    el("span", { class: "agenda-linha__periodo", text: rotuloPeriodoNoDia(periodo, data) }),
    el("span", { class: "agenda-linha__titulo", text: titulo }),
    sub ? el("span", { class: "agenda-linha__sub", text: sub }) : null,
  ]);
  return el("div", { class: `agenda-linha${status ? " agenda-linha--" + status : ""}${movido ? " agenda-linha--movido" : ""}` }, [
    el("div", { class: "agenda-linha__topo" }, [esq, controles]),
    extra || null,
  ]);
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

/** Uma entrada de `montarDia` como linha clicável. */
export function linhaEntrada(entrada, data, { resumoCorrida, fcMax } = {}) {
  if (entrada.tipo === "sessao") return linhaSessao(entrada, data);
  if (entrada.tipo === "corrida") return linhaCorrida(entrada, resumoCorrida, data, fcMax);
  if (entrada.tipo === "mesclada") return linhaCombinada(entrada);
  return linhaAvulsa(entrada);
}

/** Abre a folha de uma entrada da semana (a mesma da tela Hoje e de Treinos). */
export function abrirFolhaEntrada(entrada, data) {
  if (entrada.tipo === "sessao") {
    if (entrada.log && entrada.log.status === "mesclada") { if (entrada.merge) sheetCombinada(entrada.merge); return; }
    sheetSessao({ item: entrada.item, data, log: entrada.log, entrada });
  } else if (entrada.tipo === "corrida") sheetCorrida(entrada, data);
  else if (entrada.tipo === "mesclada") sheetCombinada(entrada.merge);
  else sheetSessao({ log: entrada.log, data: entrada.log.data, avulsa: true });
}

/** Origem de um merge: aponta para a combinada, sem check próprio. */
function linhaOrigemMesclada(entrada) {
  const { item, merge, periodo } = entrada;
  const sub = merge
    ? `Mesclada → ${nomeDiaSemana(merge.data)} (${merge.rotulo})${merge.status === "feito" ? " · coberta" : ""}`
    : "Mesclada";
  return linha({
    periodo,
    data: entrada.log.data,
    titulo: tituloSessao(item.tipo, item.rotulo),
    sub,
    status: merge && merge.status === "feito" ? "mesclada-coberta" : "mesclada",
    onTitulo: () => { if (merge) sheetCombinada(merge); },
    controles: el("span", { class: "marca-mesclada", "aria-hidden": "true", text: "⇄" }),
  });
}

/** A sessão combinada: check de 1 toque como as outras; tocar no nome abre o plano. */
function linhaCombinada({ merge, periodo }) {
  const acao = (st) => () => agir(() => alternarCombinada(merge, st));
  const partes = ["Sessão combinada"];
  if (merge.status) partes.push(ROTULO_STATUS[merge.status]);
  if (merge.duracaoMin) partes.push(`${merge.duracaoMin} min`);
  if (merge.rpe) partes.push(`RPE ${merge.rpe}`);
  if (!merge.status && merge.plano) partes.push(`≈ ${merge.plano.minutos} min · ${merge.plano.series} séries`);
  const avisoDia = el("span", { class: "agenda-linha__aviso" });
  if (merge.status !== "feito") {
    avisoDiaSeguinte(merge.data).then((t) => { if (t) avisoDia.textContent = "Dia seguinte pesado: " + t.charAt(0).toLowerCase() + t.slice(1); }).catch(() => {});
  }
  const no = linha({
    periodo,
    data: merge.data,
    titulo: `Musculação — ${merge.rotulo}`,
    sub: partes.join(" · "),
    status: merge.status,
    onTitulo: () => sheetCombinada(merge),
    controles: botoesStatus(merge.status, { feito: acao("feito"), nao_feito: acao("nao_feito") }),
  });
  no.classList.add("agenda-linha--combinada");
  no.querySelector(".agenda-linha__info").appendChild(avisoDia);
  return no;
}

function linhaSessao(entrada, data) {
  const { item, log, periodo, remanejado, movimento } = entrada;
  if (log && log.status === "mesclada") return linhaOrigemMesclada(entrada);
  const atual = log ? log.status : null;
  const acao = (st) => () => agir(() => alternarSessao(item, data, st, log));
  const movido = textoMovido(movimento, item, data);
  const sub = [
    movido,
    remanejado ? `Feito ${naDia(nomeDiaSemana(remanejado.data))} (${ddmm(remanejado.data)})` : detalhesLog(log),
  ].filter(Boolean).join(" · ");
  return linha({
    periodo,
    data,
    titulo: tituloSessao(item.tipo, item.rotulo) + (item.opcional ? " (opcional)" : ""),
    sub: sub || null,
    status: atual || (remanejado ? "remanejado" : null),
    movido: !!movido,
    onTitulo: () => sheetSessao({ item, data, log, entrada }),
    controles: botoesStatus(atual, { feito: acao("feito"), nao_feito: acao("nao_feito") }),
  });
}

function linhaAvulsa({ log, periodo, item, credita }) {
  const origem = credita && item ? `Vale pelo treino de ${NOMES_DIA[item.diaSemana]}` : "Fora da agenda";
  return linha({
    periodo,
    data: log.data,
    titulo: tituloSessao(log.tipo, log.rotulo),
    sub: origem + " · " + detalhesLog(log),
    status: log.status,
    onTitulo: () => sheetSessao({ log, data: log.data, avulsa: true }),
    controles: botoesStatus(log.status, { feito: () => agir(() => desmarcarSessao(log)) }),
  });
}

const textoRpe = (w) => (w.rpeMin === w.rpeMax ? `${w.rpeMin}` : `${w.rpeMin}–${w.rpeMax}`);

/**
 * Detalhe de um treino do plano de corrida (objetivo, metas, estrutura), oculto
 * até ser aberto. Usado na linha da agenda e no card "Próxima corrida".
 */
export function detalheCorrida(w, fase, fcMax) {
  const pendente = !corridaFeita(w.status) && w.status !== "nao_realizado";
  return el("div", { class: "agenda-linha__detalhe hidden" }, [
    w.objetivoFisiologico ? el("p", { class: "sub", text: w.objetivoFisiologico }) : null,
    el("div", { class: "metarow" }, [
      metaItem("Duração", `${w.duracaoMin} min`),
      w.rpeMin != null ? metaItem("RPE", textoRpe(w)) : null,
      w.zonaFC ? metaItem("Zona FC", textoZonaFC(w.zonaFC, fcMax)) : null,
      fase ? metaItem("Fase", fase.nome) : null,
    ]),
    el("div", { class: "estrutura" }, [
      blocoEstrutura("Aquecimento", w.aquecimento),
      blocoEstrutura("Principal", w.partePrincipal),
      blocoEstrutura("Desaquec.", w.desaquecimento),
    ]),
    w.semanaAbsorcao ? el("span", { class: "badge badge--absorcao", text: "Semana de absorção" }) : null,
    pendente
      ? botao("Registrar corrida", { variante: "primary", bloco: true, onClick: () => irPara("registrar/" + w.id) })
      : null,
  ]);
}

/** Marca a corrida como feita: o ✓ sempre leva ao formulário. `aoVoltar` é a rota depois de salvar. */
export async function abrirRegistroCorrida(w, aoVoltar = null) {
  if (corridaFeita(w.status)) {
    const comp = await repo.completedPorPlanned(w.id);
    if (comp) irPara("detalhe/" + comp.id);
  } else {
    irPara("registrar/" + w.id + (aoVoltar ? "/" + aoVoltar : ""));
  }
}

function sheetCorrida({ planned: w, periodo }, data) {
  const feita = corridaFeita(w.status);
  const entrada = { tipo: "corrida", planned: w, periodo };
  const fechar = abrirSheet(`Corrida — ${w.titulo}`, el("div", { class: "stack" }, [
    w.encurtada && !feita ? el("p", { class: "sub", text: "Encurtada ao reorganizar a semana." }) : null,
    el("div", { class: "lista-acoes" }, [
      botao(feita ? "Ver treino" : "Registrar corrida", { variante: "primary", bloco: true, onClick: () => { fechar(); abrirRegistroCorrida(w, "semana"); } }),
      !feita ? botao(w.status === "nao_realizado" ? "Tirar “não feito”" : "Marcar como não feito", {
        bloco: true, onClick: async () => { fechar(); await agir(() => alternarCorridaNaoFeita(w)); },
      }) : null,
      podeMover(entrada) ? botao("Mover para…", { variante: "ghost", bloco: true, onClick: () => sheetMover(entrada, data) }) : null,
    ]),
  ]));
}

function linhaCorrida({ planned: w, periodo }, resumoCorrida, data, fcMax) {
  const concluido = corridaFeita(w.status);
  const naoFeito = w.status === "nao_realizado";
  const atual = concluido ? "feito" : naoFeito ? "nao_feito" : null;
  const partes = [w.encurtada && !concluido ? "Encurtada" : `${w.duracaoMin} min`];
  if (w.rpeMin != null) partes.push(`RPE ${textoRpe(w)}`);
  partes.push(`Semana ${w.semana}`);
  if (concluido) partes.unshift(w.status === "encurtado" ? "Encurtado" : "Feito");
  if (naoFeito) partes.unshift("Não realizado");
  const movida = w.status === "reagendado" && w.dataOriginal && w.dataOriginal !== w.dataPlanejada;
  if (movida) partes.unshift(`Movida de ${nomeDiaSemana(w.dataOriginal)} (${ddmm(w.dataOriginal)})`);

  const detalhe = detalheCorrida(w, resumoCorrida && resumoCorrida.fase, fcMax);

  const abrirRegistro = () => abrirRegistroCorrida(w);

  return linha({
    periodo,
    data: data || w.dataPlanejada,
    titulo: `Corrida — ${w.titulo}`,
    sub: partes.join(" · "),
    status: atual,
    movido: movida,
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

export const OPCOES_RPE = Array.from({ length: 10 }, (_, i) => ({ valor: i + 1, rotulo: String(i + 1) }));

export function inputMinutos(valor) {
  return el("input", {
    type: "number", id: "sess-min", inputmode: "numeric", min: "0", step: "1",
    placeholder: "opcional", value: valor ?? "",
  });
}
export const lerMinutos = (input) => (input.value ? Math.max(0, Math.round(Number(input.value))) : null);

/** Detalhe de uma sessão: status, duração e RPE opcionais. */
function sheetSessao({ item, data, log, avulsa, entrada }) {
  const titulo = item ? tituloSessao(item.tipo, item.rotulo) : tituloSessao(log.tipo, log.rotulo);
  const status = avulsa ? null : segmentos(
    [{ valor: "feito", rotulo: "Feito" }, { valor: "nao_feito", rotulo: "Não feito" }],
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
  const mov = entrada && entrada.movimento;
  const voltar = mov
    ? botao(`Voltar para ${nomeDiaSemana(mov.dataOrigem)} · ${ROTULO_PERIODO[item.periodo].toLowerCase()}`, {
        variante: "ghost", bloco: true, onClick: async () => { fechar(); await agir(() => voltarAoPrevisto(entrada)); },
      })
    : null;

  const moverPara = entrada && podeMover(entrada)
    ? botao("Mover para…", { variante: "ghost", bloco: true, onClick: () => sheetMover(entrada, data) })
    : null;

  const fechar = abrirSheet(titulo, el("div", { class: "stack" }, [
    status ? status.node : null,
    campo("Duração (min)", min),
    el("div", { class: "campo" }, [el("label", { text: "RPE (opcional)" }), rpe.node]),
    el("div", { class: "lista-acoes" }, [salvar, moverPara, voltar, remover]),
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
    textoMusculacao(r) ? el("p", { class: "sub pequeno semana-resumo__mus", text: textoMusculacao(r) }) : null,
  ]);
}

/** "Musculação: 4 de 4 cobertas (1 mesclada)" — só quando a semana teve merge. */
export function textoMusculacao(r) {
  const m = r.musculacao;
  if (!m || !m.mescladas) return null;
  return `Musculação: ${m.cobertas} de ${m.previstas} cobertas (${m.mescladas} mesclada${m.mescladas > 1 ? "s" : ""})`;
}
