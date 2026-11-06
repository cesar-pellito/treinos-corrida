// semana.js — aba Semana: check-in do dia, status da semana, opções para reorganizar
// e a grade de 7 dias × 2 slots. O app só sugere: nada muda sem tocar em Aceitar.
// No código, cada opção é uma "rota"; a palavra não aparece na tela.

import {
  aceitarRota, definirExcecao, desfazerRota, manterComoEsta, manterSemana, recalcular, rotaParaDesfazer, salvarCheckinDeHoje, situacaoSemana,
} from "../services/semana.js";
import { slotPassou, slotPodeSerSugerido } from "../services/motor-rotas.js";
import { alternarCorridaNaoFeita, alternarSessao, ROTULO_TIPO } from "../services/agenda.js";
import { alternarCombinada } from "../services/merge.js";
import { corridaFeita } from "../services/dominio.js";
import { deISODate, nomeDiaSemana, paraISODate } from "../services/dates.js";
import { CHECKIN } from "../data/rotas-config.js";
import { recarregar } from "./router.js";
import { el, card, botao, tituloVista, abrirSheet, seletorBotoes, toast } from "./components/ui.js";
import { abrirFolhaEntrada, abrirRegistroCorrida, agir, botoesStatus } from "./components/agenda-ui.js";

// Resultado do último Reorganizar Semana. Só vale enquanto a semana não mudar (assinatura).
let ultimoCalculo = null;
let checkinAberto = null;

const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};
const horaAgora = (d) => `${nomeDiaSemana(paraISODate(d), true)}, ${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

function cardCheckin(checkin) {
  const atual = { ...CHECKIN.padrao, ...(checkin || {}) };
  const salvar = async (mudanca) => {
    checkinAberto = true; // fica aberto para responder as outras perguntas
    try { await salvarCheckinDeHoje({ ...atual, ...mudanca }); }
    catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
    await recarregar();
  };
  const aberto = checkinAberto ?? !checkin;
  const dores = [atual.dorUpper && "upper", atual.dorLower && "lower"].filter(Boolean).join(" e ") || "nenhuma";
  const alternar = el("button", {
    type: "button", class: "btn btn--ghost", text: aberto ? "Fechar" : "Editar",
    onClick: async () => { checkinAberto = !aberto; await recarregar(); },
  });
  const cabeca = el("div", { class: "checkin-resumo" }, [
    el("div", {}, [
      el("p", { class: "eyebrow", text: "Check-in de hoje" }),
      aberto ? null : el("p", { class: "sub", text: checkin ? `Disposição ${atual.disposicao} de 5 · dor muscular: ${dores} · fáscia ${atual.fascia ? "doendo" : "ok"}` : "Sem check-in hoje." }),
    ]),
    alternar,
  ]);
  if (!aberto) return card([cabeca]);

  const disposicao = seletorBotoes([1, 2, 3, 4, 5].map((n) => ({ valor: n, rotulo: String(n) })), {
    valorInicial: checkin ? atual.disposicao : null, colunas: 5, onChange: (v) => salvar({ disposicao: v }),
  });
  const dor = (campo, rotulo) => el("button", {
    type: "button", class: "chip", text: rotulo, "aria-pressed": !!atual[campo], onClick: () => salvar({ [campo]: !atual[campo] }),
  });
  const fascia = seletorBotoes([{ valor: false, rotulo: "Não" }, { valor: true, rotulo: "Sim" }], {
    valorInicial: atual.fascia, colunas: 2, onChange: (v) => salvar({ fascia: v }),
  });
  return card([
    cabeca,
    el("div", { class: "checkin-pergunta" }, [
      el("span", { text: "Como está sua disposição?" }), disposicao.node,
      el("div", { class: "checkin-ajuda" }, [el("span", { text: "1 = sem energia" }), el("span", { text: "5 = muita energia" })]),
    ]),
    el("div", { class: "checkin-pergunta" }, [
      el("span", { text: "Dor muscular?" }),
      el("div", { class: "chips" }, [dor("dorUpper", "Upper"), dor("dorLower", "Lower")]),
      el("div", { class: "checkin-ajuda" }, [el("span", { text: "Pode marcar os dois. Nenhum marcado = sem dor." })]),
    ]),
    el("div", { class: "checkin-pergunta" }, [
      el("span", { text: "Dor na fáscia?" }), fascia.node,
      el("div", { class: "checkin-ajuda" }, [el("span", { text: "No primeiro passo ao levantar." })]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Status da semana
// ---------------------------------------------------------------------------

function nomeDaEntrada(e) {
  if (e.tipo === "corrida") return "Corrida";
  if (e.tipo === "mesclada") return e.merge.rotulo;
  const item = e.item || e.log;
  if (item.tipo === "karate") return `Karatê ${String(item.rotulo || "").toLowerCase()}`.trim();
  return item.rotulo || ROTULO_TIPO[item.tipo];
}

function linhaSemRegistro(sessao) {
  const e = sessao.fonte;
  const acoes = e.tipo === "corrida"
    ? { feito: () => abrirRegistroCorrida(e.planned, "semana"), nao_feito: () => agir(() => alternarCorridaNaoFeita(e.planned)) }
    : e.tipo === "mesclada"
      ? { feito: () => agir(() => alternarCombinada(e.merge, "feito")), nao_feito: () => agir(() => alternarCombinada(e.merge, "nao_feito")) }
      : { feito: () => agir(() => alternarSessao(e.item, sessao.data, "feito", e.log)), nao_feito: () => agir(() => alternarSessao(e.item, sessao.data, "nao_feito", e.log)) };
  return el("div", { class: "sem-registro" }, [
    el("span", { class: "sem-registro__nome", text: `${nomeDaEntrada(e)} · ${nomeDiaSemana(sessao.data, true)}` }),
    botoesStatus(null, acoes),
  ]);
}

function cardStatus(sit, aoRecalcular) {
  const { avaliacao, pendente, aviso } = sit;
  const botaoRecalcular = botao("Reorganizar Semana", { variante: aviso ? "primary" : undefined, bloco: true, onClick: aoRecalcular });
  const n = avaliacao.perdidas.length;
  const semRegistro = n ? [
    el("p", { class: "strong", text: `${n} ${n === 1 ? "treino" : "treinos"} sem registro` }),
    el("p", { class: "sub", text: "Marque o que você fez e depois reorganize." }),
    ...avaliacao.perdidas.map(linhaSemRegistro),
  ] : [];
  const mantidas = avaliacao.mantidas.length
    ? el("p", { class: "sub", text: `Você manteve: ${avaliacao.mantidas.map((v) => v.texto).join(" ")}` })
    : null;
  if (!aviso) {
    // Sem registro que não justifica aviso (hoje, karatê leve, sem para onde ir): só lembra de marcar.
    return el("section", { class: `card semana-status${n ? "" : " semana-status--ok"}` }, [
      n ? null : el("p", { class: "strong", text: "Semana em dia, segue como está" }),
      ...semRegistro,
      mantidas,
      botaoRecalcular,
    ]);
  }
  return el("section", { class: "card semana-status semana-status--aviso" }, [
    el("p", { class: "eyebrow", text: "Sua semana mudou. Quer reorganizar?" }),
    avaliacao.motivo ? el("p", { class: "strong", text: avaliacao.motivo }) : null,
    ...semRegistro,
    pendente ? el("p", { class: "strong", text: "Treino com ✕ que dá para recuperar" }) : null,
    pendente ? el("p", { class: "sub", text: "Toque em Reorganizar Semana para ver as opções." }) : null,
    mantidas,
    botaoRecalcular,
  ]);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

function cardDesfazer(guardada) {
  const desfazer = botao("Desfazer", {
    bloco: true, onClick: async () => {
      desfazer.disabled = true;
      try { await desfazerRota(); toast("Mudanças desfeitas."); }
      catch (e) { toast("Não foi possível desfazer: " + (e && e.message)); }
      ultimoCalculo = null;
      await recarregar();
    },
  });
  return el("section", { class: "card rota" }, [
    el("p", { class: "eyebrow", text: "Treinos Reorganizados" }),
    guardada.mudancas.length ? el("ul", {}, guardada.mudancas.map((m) => el("li", { text: m }))) : null,
    desfazer,
  ]);
}

function cardRota(rota) {
  const n = rota.ops.length;
  const aceitar = botao("Aceitar", {
    variante: "primary", bloco: true, onClick: async () => {
      aceitar.disabled = true;
      try { await aceitarRota(rota); toast("Treinos Reorganizados."); }
      catch (e) { toast("Parte das mudanças não foi aplicada: " + (e && e.message)); }
      ultimoCalculo = null;
      await recarregar();
    },
  });
  const fica = (rota.fechar || []).map((f) => `${f.rotulo} (${f.dia})`).join(", ");
  return el("section", { class: "card rota" }, [
    el("p", { class: "eyebrow", text: n === 1 ? "1 mudança" : `${n} mudanças` }),
    rota.mudancas.length ? el("ul", {}, rota.mudancas.map((m) => el("li", { text: m }))) : null,
    el("p", { class: "sub", text: rota.motivo }),
    fica ? el("p", { class: "sub", text: `Ao aceitar, viram não feito: ${fica}.` }) : null,
    aceitar,
  ]);
}

function secaoDescartadas(descartadas) {
  if (!descartadas || !descartadas.length) return null;
  return el("details", { class: "card" }, [
    el("summary", { text: "O que não fazer?" }),
    el("ul", {}, descartadas.map((d) => el("li", { text: d }))),
  ]);
}

/** Sobrepõe o motor: a semana fica como está e o aviso só volta se surgir algo novo. */
function cardManterEscolha() {
  const manter = botao("Manter minha escolha", {
    bloco: true, onClick: async () => {
      manter.disabled = true;
      try { await manterSemana(); toast("Escolha mantida."); }
      catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
      ultimoCalculo = null;
      await recarregar();
    },
  });
  return el("section", { class: "card rota" }, [
    el("p", { class: "eyebrow", text: "Sem mudanças" }),
    el("p", { class: "strong", text: "Deixar a semana como está" }),
    el("p", { class: "sub", text: "O aviso só volta se surgir algo novo. Treino sem registro continua aqui para você marcar." }),
    manter,
  ]);
}

function secaoOfertas(calculo) {
  const manter = botao("Manter", {
    bloco: true, onClick: async () => {
      manter.disabled = true;
      await manterComoEsta();
      ultimoCalculo = null;
      toast("Mantido. Nada mudou.");
      await recarregar();
    },
  });
  const titulo = calculo.pesos.length ? "O check-in pesa no treino de hoje" : "Treino com ✕ que dá para recuperar";
  return el("div", { class: "rotas", id: "rotas" }, [
    el("p", { class: "eyebrow", text: titulo }),
    el("section", { class: "card rota" }, [
      el("p", { class: "eyebrow", text: "Sem mudanças" }),
      el("p", { class: "strong", text: "Manter como está" }),
      ...calculo.pesos.map((p) => el("p", { class: "sub", text: p.texto })),
      ...calculo.ficamComoEstao.map((t) => el("p", { class: "sub", text: t })),
      manter,
    ]),
    ...calculo.rotas.map(cardRota),
    calculo.rotas.length ? null : el("p", { class: "sub", text: "Não há alternativa melhor dentro das regras." }),
  ]);
}

function secaoRotas(calculo) {
  if (calculo.tipo === "ofertas") return secaoOfertas(calculo);
  if (calculo.tipo === "comprometida") {
    return el("div", { class: "rotas", id: "rotas" }, [
      el("section", { class: "card semana-status semana-status--comprometida" }, [
        el("p", { class: "strong", text: "Semana comprometida" }),
        el("p", { class: "sub", text: calculo.rotas.length ? "Não dá para resolver tudo com até 3 mudanças. Esta opção garante o piso de musculação." : "Nenhuma opção garante o piso de musculação nesta semana." }),
      ]),
      ...calculo.rotas.map(cardRota),
      cardManterEscolha(),
      secaoDescartadas(calculo.descartadas),
    ]);
  }
  return el("div", { class: "rotas", id: "rotas" }, [
    el("p", { class: "eyebrow", text: "Opções de Treinos" }),
    ...calculo.rotas.map(cardRota),
    cardManterEscolha(),
    secaoDescartadas(calculo.descartadas),
  ]);
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

function notaDaEntrada(e, sessao, data) {
  const partes = [];
  if (e.tipo === "sessao") {
    if (e.log && e.log.status === "mesclada") return e.merge ? [`⇄ ${nomeDiaSemana(e.merge.data)}`] : ["⇄ junto"];
    if (e.remanejado) return [`feito ${nomeDiaSemana(e.remanejado.data, true)}`];
    if (e.movimento && e.movimento.dataOrigem !== data) partes.push(`movido de ${nomeDiaSemana(e.movimento.dataOrigem, true)}`);
    if (e.item.opcional) partes.push("opcional");
  }
  if (e.tipo === "corrida") {
    if (e.planned.status === "encurtado") partes.push("encurtado");
    else if (e.planned.encurtada && !corridaFeita(e.planned.status)) partes.push("encurtada");
    if (e.planned.dataOriginal && e.planned.dataOriginal !== e.planned.dataPlanejada) partes.push(`movida de ${nomeDiaSemana(e.planned.dataOriginal, true)}`);
  }
  if (e.tipo === "mesclada") partes.push("sessão combinada");
  if (e.tipo === "avulsa") partes.push("fora da agenda");
  if (sessao && sessao.status === "feito") partes.unshift("feito");
  if (sessao && sessao.status === "nao_feito") partes.unshift("não feito");
  if (sessao && sessao.status === "perdida") partes.unshift("sem registro");
  return partes;
}

function celulaDaEntrada(e, data, sessoesPorFonte) {
  const sessao = sessoesPorFonte.get(e);
  const statusBase = sessao ? sessao.status : null;
  const saiu = e.tipo === "sessao" && e.log && e.log.status === "mesclada";
  const mudou = !["feito", "nao_feito"].includes(statusBase) && (
    (e.tipo === "sessao" && e.movimento && e.movimento.dataOrigem !== data) ||
    (e.tipo === "corrida" && (e.planned.encurtada || (e.planned.dataOriginal && e.planned.dataOriginal !== e.planned.dataPlanejada))) ||
    e.tipo === "mesclada"
  );
  const classes = ["grade-cel", statusBase && `grade-cel--${statusBase}`, saiu && "grade-cel--saiu", mudou && "grade-cel--mudou"].filter(Boolean).join(" ");
  const nota = notaDaEntrada(e, sessao, data).join(" · ");
  return el("button", { type: "button", class: classes, onClick: () => abrirFolhaEntrada(e, data) }, [
    el("span", { class: "grade-cel__t", text: nomeDaEntrada(e) }),
    nota ? el("span", { class: "grade-cel__n", text: nota }) : null,
  ]);
}

function celulaVazia(ctx, data, periodo) {
  const excecao = ctx.excecoes[data];
  const bloqueado = excecao && (excecao.bloqueio === "dia" || excecao.bloqueio === periodo);
  if (bloqueado) return el("div", { class: "grade-cel grade-cel--vazio grade-cel--bloqueado", text: "não posso" });
  if (slotPassou(ctx, data, periodo)) return el("div", { class: "grade-cel grade-cel--vazio grade-cel--passou", text: "passou" });
  return el("div", { class: "grade-cel grade-cel--vazio", text: slotPodeSerSugerido(ctx, data, periodo) ? "livre" : "—" });
}

function sheetDia(data, excecao) {
  const bloqueio = excecao ? excecao.bloqueio : null;
  const feriado = !!(excecao && excecao.feriado);
  const salvar = async (fechar, mudanca) => {
    fechar();
    try { await definirExcecao(data, { bloqueio, feriado, ...mudanca }); }
    catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
    await recarregar();
  };
  const opcao = (valor, rotulo) => botao(rotulo, { variante: bloqueio === valor ? "primary" : undefined, onClick: () => salvar(fechar, { bloqueio: bloqueio === valor ? null : valor }) });
  const fechar = abrirSheet(`${nomeDiaSemana(data)}, ${ddmm(data)}`, el("div", { class: "stack" }, [
    el("p", { class: "sub", text: "Vale só para esta semana." }),
    el("p", { class: "strong", text: "Não posso" }),
    el("div", { class: "par-campos", style: { gridTemplateColumns: "repeat(3, 1fr)" } }, [opcao("manha", "Manhã"), opcao("noite", "Noite"), opcao("dia", "Dia todo")]),
    botao(feriado ? "Tirar feriado" : "Marcar como feriado", { bloco: true, onClick: () => salvar(fechar, { feriado: !feriado }) }),
  ]));
}

function cardGrade(sit) {
  const { semana, estado } = sit;
  const { ctx } = estado;
  const sessoesPorFonte = new Map(estado.sessoes.map((s) => [s.fonte, s]));
  const filhos = [el("span", {}), el("span", { class: "grade-semana__cab", text: "Manhã" }), el("span", { class: "grade-semana__cab", text: "Noite" })];
  for (const dia of semana.dias) {
    const excecao = ctx.excecoes[dia.data];
    filhos.push(el("button", {
      type: "button", class: `grade-dia${dia.data === ctx.hoje ? " grade-dia--hoje" : ""}`, "aria-label": `Opções de ${nomeDiaSemana(dia.data)}`,
      onClick: () => sheetDia(dia.data, excecao),
    }, [
      el("b", { text: nomeDiaSemana(dia.data, true).replace(/^./, (l) => l.toUpperCase()) }),
      el("small", { text: ddmm(dia.data) }),
      excecao && excecao.feriado ? el("small", { class: "grade-dia__feriado", text: "feriado" }) : null,
    ]));
    for (const periodo of ["manha", "noite"]) {
      const entradas = dia.entradas.filter((e) => e.periodo === periodo && !(e.tipo === "avulsa" && e.log.status !== "feito"));
      filhos.push(el("div", { class: "grade-slot" }, entradas.length
        ? entradas.map((e) => celulaDaEntrada(e, dia.data, sessoesPorFonte))
        : [celulaVazia(ctx, dia.data, periodo)]));
    }
  }
  return card([
    el("div", { class: "grade-semana" }, filhos),
    el("p", { class: "sub pequeno", style: { marginTop: "10px" }, text: "Sábado, domingo e feriado: manhã até 13h; a segunda coluna vale para tarde e noite. Toque no dia para “não posso” e “feriado”." }),
  ]);
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export async function renderSemana(container) {
  const agora = new Date();
  const sit = await situacaoSemana(agora);
  const paraDesfazer = await rotaParaDesfazer(agora);

  const aoRecalcular = async () => {
    try {
      const calculo = await recalcular();
      ultimoCalculo = calculo;
      if (calculo.tipo === "em_dia") { ultimoCalculo = null; toast("Semana em dia, segue como está."); }
    } catch (e) {
      toast("Não foi possível reorganizar: " + (e && e.message));
    }
    await recarregar();
    const rotas = document.getElementById("rotas");
    if (rotas) rotas.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  container.appendChild(el("div", { class: "semana-topo" }, [
    tituloVista("Semana"),
    el("span", { class: "muted pequeno", text: horaAgora(agora) }),
  ]));
  container.appendChild(cardCheckin(sit.checkin));
  if (paraDesfazer) container.appendChild(cardDesfazer(paraDesfazer));
  container.appendChild(cardStatus(sit, aoRecalcular));
  if (ultimoCalculo && ultimoCalculo.assinatura === sit.assinatura) container.appendChild(secaoRotas(ultimoCalculo));
  else if (ultimoCalculo) ultimoCalculo = null;
  container.appendChild(cardGrade(sit));
}
