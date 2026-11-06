// merge-ui.js — folhas do "Juntar sessões": escolher as duas sessões e o dia,
// ver a sugestão da sessão combinada, reorganizar o resto da semana, mover uma
// sessão sem arrastar e abrir/desfazer a combinada. Usado em Treinos → Semana e
// na tela Hoje (via agenda-ui.js).

import { recarregar } from "../router.js";
import { carregarSemana, primeiroDiaSemana, statusDaSessao, ROTULO_PERIODO, ROTULO_STATUS } from "../../services/agenda.js";
import {
  pendentesDaSemana, validarMerge, montarSugestao, avisoDiaSeguinte, juntar, desfazer,
  editarCombinada, sugerirReorganizacao, aplicarReorganizacao,
} from "../../services/merge.js";
import { ehLower, ehUpper } from "../../services/agenda.js";
import { hoje as hojeISO, nomeDiaSemana, deISODate, somarDias, inicioDaSemana } from "../../services/dates.js";
import { el, botao, abrirSheet, seletorBotoes, segmentos, toast, campo } from "./ui.js";
import { agir, OPCOES_RPE, inputMinutos, lerMinutos } from "./agenda-ui.js";
import { moverComAviso } from "./aviso-semana.js";

const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const diaCurto = (iso) => `${nomeDiaSemana(iso, true)} ${ddmm(iso)}`;
const naData = (iso) => (["sábado", "domingo"].includes(nomeDiaSemana(iso)) ? "no " : "na ") + nomeDiaSemana(iso);

/** Caixa de aviso (amarela). */
function aviso(texto) {
  return el("p", { class: "aviso-caixa", text: texto });
}

const ROTULO_PAPEL = { composto: "composto", isolador: "isolador", acessorio: "acessório" };

/** A sugestão (ou o snapshot gravado no merge): ordem, séries, tempo, volume e cortes. */
export function blocoPlano(p) {
  if (!p) return el("p", { class: "sub", text: "Sem sugestão de exercícios para esta sessão." });
  const filhos = [];
  if (p.semConfig && p.semConfig.length) {
    filhos.push(el("p", { class: "sub pequeno", text: `Sem itens configurados para ${p.semConfig.join(" e ")} (js/data/sessoes-musculacao.js).` }));
  }
  if (p.itens.length) {
    filhos.push(el("ol", { class: "merge-plano" }, p.itens.map((it) =>
      el("li", {}, [
        el("span", { class: "merge-plano__series", text: `${it.series}×` }),
        el("span", { class: "merge-plano__nome", text: it.nome }),
        it.bisetCom ? el("span", { class: "tag", text: `bi-set c/ ${it.bisetCom.toLowerCase()}` }) : el("span", { class: "tag tag--fraca", text: ROTULO_PAPEL[it.papel] || it.papel }),
      ]))));
  }
  const [aMin, aMax] = p.alvoMin || [60, 70];
  filhos.push(el("p", { class: `strong${p.excede ? " texto-aviso" : ""}`, text: `${p.series} séries de trabalho · ≈ ${p.minutos} min` }));
  filhos.push(el("p", { class: "sub pequeno", text: `Teto ≈ ${p.teto} séries · alvo ${aMin} a ${aMax} min${p.excede ? " · ainda passa: corte mais ao fazer" : ""}` }));
  if (p.cortes.length) {
    const itens = p.cortes.filter((c) => c.tipo === "item").map((c) => c.nome);
    const series = p.cortes.filter((c) => c.tipo === "serie").map((c) => c.nome);
    const partes = [];
    if (itens.length) partes.push(itens.join(", "));
    if (series.length) partes.push(`1 série a menos em ${[...new Set(series)].join(", ")}`);
    filhos.push(el("p", { class: "sub pequeno", text: `Cortado para caber (nesta ordem): ${partes.join("; ")}.` }));
  }
  const comMeta = p.volume.filter((v) => v.meta != null);
  if (comMeta.length) {
    filhos.push(el("div", { class: "merge-volume" }, comMeta.map((v) =>
      el("div", { class: `merge-volume__linha${v.series >= v.meta ? " ok" : ""}` }, [
        el("span", { text: v.nome }),
        el("span", { class: "strong", text: `${v.series} de ~${v.meta}` }),
      ]))));
    filhos.push(el("p", { class: "sub pequeno", text: "Séries da sessão × meta semanal do grupo. É o plano; o volume real fica no Gravl." }));
  }
  return el("div", { class: "stack" }, filhos);
}

// ---------------------------------------------------------------------------
// Juntar sessões
// ---------------------------------------------------------------------------

function textoPendente(e) {
  const st = statusDaSessao(e);
  return st ? ROTULO_STATUS[st].toLowerCase() : "pendente";
}

/** Sugere o par inicial: Lower A + B ou Upper A + B, se houver; senão nada. */
function parInicial(pend) {
  for (const fam of [ehLower, ehUpper]) {
    const do_ = pend.filter((p) => fam(p.entrada.item.rotulo));
    if (do_.length >= 2) return do_.slice(0, 2);
  }
  return [];
}

/** Folha "Juntar sessões" para a semana de `dataRef`. */
export async function sheetJuntar(dataRef = hojeISO()) {
  const semana = await carregarSemana(dataRef);
  const pend = pendentesDaSemana(semana);
  if (pend.length < 2) {
    toast("Precisa de duas sessões de musculação pendentes nesta semana.");
    return;
  }
  const hoje = hojeISO();
  const escolhidas = new Set(parInicial(pend));
  const lista = el("div", { class: "agenda-lista" });
  const desenharLista = () => {
    lista.replaceChildren(...pend.map((p) => el("button", {
      type: "button", class: "merge-op", "aria-pressed": escolhidas.has(p),
      onClick: () => {
        if (escolhidas.has(p)) escolhidas.delete(p);
        else {
          if (escolhidas.size >= 2) escolhidas.delete([...escolhidas][0]);
          escolhidas.add(p);
        }
        desenharLista(); atualizar();
      },
    }, [
      el("span", { class: "strong", text: p.entrada.item.rotulo }),
      el("span", { class: "sub pequeno", text: `${diaCurto(p.data)} · ${textoPendente(p.entrada)}` }),
    ])));
  };

  const dias = semana.dias.map((d) => ({ valor: d.data, rotulo: diaCurto(d.data) }));
  const dataInicial = hoje >= semana.inicio && hoje <= semana.fim ? hoje : semana.inicio;
  const dia = seletorBotoes(dias, { valorInicial: dataInicial, colunas: 4, onChange: () => atualizar() });
  const periodo = segmentos([{ valor: "manha", rotulo: "Manhã" }, { valor: "noite", rotulo: "Noite" }], { valorInicial: "manha" });

  const previa = el("div", { class: "stack" });
  const erro = el("p", { class: "erro" });
  let versao = 0;
  async function atualizar() {
    const minha = ++versao;
    const esc = [...escolhidas];
    const { erros, avisos } = validarMerge({ escolhidas: esc, data: dia.get(), inicio: semana.inicio });
    erro.textContent = esc.length === 2 ? erros.join(" ") : "";
    juntarBtn.disabled = erros.length > 0;
    if (esc.length !== 2) { previa.replaceChildren(el("p", { class: "sub", text: "Escolha duas sessões." })); return; }
    const filhos = avisos.map(aviso);
    const pesado = await avisoDiaSeguinte(dia.get());
    if (minha !== versao) return;
    if (pesado) filhos.push(aviso(`Dia seguinte com corrida ou karatê intenso. ${pesado}`));
    filhos.push(blocoPlano(montarSugestao(esc.sort((a, b) => (a.data < b.data ? -1 : 1)).map((p) => p.entrada.item.rotulo))));
    previa.replaceChildren(...filhos);
  }

  const juntarBtn = botao("Juntar", {
    variante: "primary", bloco: true, onClick: async () => {
      juntarBtn.disabled = true;
      const data = dia.get();
      try {
        await juntar({ escolhidas: [...escolhidas], data, periodo: periodo.get() });
        toast(`Sessão combinada ${naData(data)}.`);
      } catch (e) {
        toast("Não foi possível juntar: " + (e && e.message));
        juntarBtn.disabled = false;
        return;
      }
      await recarregar();
      await sheetReorganizar(data);
    },
  });

  desenharLista();
  abrirSheet("Juntar sessões", el("div", { class: "stack" }, [
    el("div", { class: "campo" }, [el("label", { text: "Duas sessões pendentes da semana" }), lista]),
    el("div", { class: "campo" }, [el("label", { text: "Dia da sessão combinada" }), dia.node]),
    periodo.node,
    previa,
    erro,
    juntarBtn,
  ]));
  atualizar();
}

// ---------------------------------------------------------------------------
// Reorganizar o resto da semana
// ---------------------------------------------------------------------------

/** Oferece levar as sessões que ficaram para trás para os dias livres da semana. Nada a sugerir => não abre. */
export async function sheetReorganizar(dataRef) {
  const semana = await carregarSemana(dataRef);
  const sugestoes = sugerirReorganizacao(semana, hojeISO()).filter((s) => s.destino);
  if (!sugestoes.length) return;
  const mover = async (lista) => {
    try {
      for (const s of lista) await aplicarReorganizacao(s);
      toast(lista.length === 1 ? `Movido para ${nomeDiaSemana(lista[0].destino)}.` : "Semana reorganizada.");
    } catch (e) {
      toast("Não foi possível mover: " + (e && e.message));
    }
    await recarregar();
    await sheetReorganizar(dataRef);
  };
  abrirSheet("Reorganizar a semana", el("div", { class: "stack" }, [
    el("p", { class: "sub", text: "Estas sessões ficaram para trás. Dá para levá-las para um dia livre da semana:" }),
    el("div", { class: "agenda-lista" }, sugestoes.map((s) =>
      el("div", { class: "merge-sugestao" }, [
        el("div", {}, [
          el("span", { class: "strong", text: s.entrada.item.rotulo }),
          el("span", { class: "sub pequeno", text: ` ${diaCurto(s.data)} → ${diaCurto(s.destino)} · ${ROTULO_PERIODO[s.entrada.periodo].toLowerCase()}` }),
        ]),
        botao("Mover", { variante: "ghost", onClick: () => mover([s]) }),
      ]))),
    el("div", { class: "lista-acoes" }, [
      sugestoes.length > 1 ? botao("Mover todas", { variante: "primary", bloco: true, onClick: () => mover(sugestoes) }) : null,
      botao("Agora não", { variante: "ghost", bloco: true, onClick: () => recarregar() }),
    ]),
  ]));
}

// ---------------------------------------------------------------------------
// Mover sessão (sem arrastar)
// ---------------------------------------------------------------------------

/** Leva a entrada exibida em `dataAtual` para outro dia/período da mesma semana. */
export async function sheetMover(entrada, dataAtual) {
  const inicio = inicioDaSemana(dataAtual, await primeiroDiaSemana());
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(inicio, i)).map((d) => ({ valor: d, rotulo: diaCurto(d) }));
  const dia = seletorBotoes(dias, { valorInicial: dataAtual, colunas: 4 });
  const periodo = segmentos([{ valor: "manha", rotulo: "Manhã" }, { valor: "noite", rotulo: "Noite" }], { valorInicial: entrada.periodo });
  const titulo = entrada.item ? entrada.item.rotulo || "Sessão" : entrada.tipo === "corrida" ? "corrida" : "Sessão";
  const ok = botao("Mover", {
    variante: "primary", bloco: true, onClick: async () => {
      ok.disabled = true;
      const destino = dia.get();
      fechar();
      await moverComAviso(entrada, dataAtual, { data: destino, periodo: periodo.get(), ordem: 500 }, `Movido para ${nomeDiaSemana(destino)} · ${ROTULO_PERIODO[periodo.get()].toLowerCase()}`);
    },
  });
  const fechar = abrirSheet(`Mover ${titulo}`, el("div", { class: "stack" }, [
    el("p", { class: "sub", text: "Vale só para esta semana; a agenda-padrão não muda." }),
    el("div", { class: "campo" }, [el("label", { text: "Dia" }), dia.node]),
    periodo.node,
    ok,
  ]));
}

// ---------------------------------------------------------------------------
// Sessão combinada
// ---------------------------------------------------------------------------

/** Detalhe da combinada: origens, plano gravado, status, duração/RPE e desfazer. */
export function sheetCombinada(merge) {
  const origens = merge.origens.map((o) => `${o.rotulo} (${diaCurto(o.dataOcorrencia)})`).join(" + ");
  const status = segmentos(
    [{ valor: "", rotulo: "Pendente" }, { valor: "feito", rotulo: "Feito" }, { valor: "nao_feito", rotulo: "Não feito" }],
    { valorInicial: merge.status || "" }
  );
  const min = inputMinutos(merge.duracaoMin);
  const rpe = seletorBotoes(OPCOES_RPE, { valorInicial: merge.rpe, colunas: 5 });
  const avisoDia = el("div", {});
  avisoDiaSeguinte(merge.data).then((t) => { if (t) avisoDia.replaceChildren(aviso(`Dia seguinte com corrida ou karatê intenso. ${t}`)); });

  const salvar = botao("Salvar", {
    variante: "primary", bloco: true, onClick: async () => {
      salvar.disabled = true;
      fechar();
      await agir(() => editarCombinada(merge, { status: status.get() || null, duracaoMin: lerMinutos(min), rpe: rpe.get() }));
    },
  });
  const desfazerBtn = merge.status !== "feito"
    ? botao("Desfazer merge", {
        variante: "ghost", bloco: true, onClick: async () => {
          fechar();
          await agir(async () => { await desfazer(merge); toast("Merge desfeito: as duas sessões voltaram."); });
        },
      })
    : null;

  const fechar = abrirSheet(merge.rotulo, el("div", { class: "stack" }, [
    el("p", { class: "sub", text: `${diaCurto(merge.data)} · ${ROTULO_PERIODO[merge.periodo].toLowerCase()} · junta ${origens}` }),
    avisoDia,
    blocoPlano(merge.plano),
    status.node,
    campo("Duração (min)", min),
    el("div", { class: "campo" }, [el("label", { text: "RPE (opcional)" }), rpe.node]),
    el("div", { class: "lista-acoes" }, [salvar, desfazerBtn]),
    merge.status === "feito" ? el("p", { class: "sub pequeno", text: "Já feita: para desfazer o merge, volte o status para pendente." }) : null,
  ]));
}
