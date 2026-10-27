// agenda-editor.js — editor da semana-padrão (Ajustes → Agenda semanal).
// Mudar a agenda vale daqui para frente: sessões já registradas guardam o
// próprio snapshot (tipo, rótulo, período) e não mudam.

import {
  listarAgendaOrdenada, salvarItemAgenda, removerItemAgenda, primeiroDiaSemana,
  ROTULO_TIPO, ROTULO_PERIODO, ROTULOS_SUGERIDOS,
} from "../services/agenda.js";
import { voltar, recarregar } from "./router.js";
import { el, card, botao, cabecalhoVoltar, abrirSheet, seletorBotoes, segmentos, toast, campo } from "./components/ui.js";

const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const CURTO_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function textoItem(i) {
  const base = i.rotulo ? `${ROTULO_TIPO[i.tipo]} — ${i.rotulo}` : ROTULO_TIPO[i.tipo];
  return base + (i.opcional ? " (opcional)" : "");
}

export async function renderEditorAgenda(container) {
  container.appendChild(cabecalhoVoltar("Agenda semanal", voltar));
  const [itens, pds] = await Promise.all([listarAgendaOrdenada(), primeiroDiaSemana()]);

  container.appendChild(el("p", { class: "sub", text: "O que está previsto em cada dia. Vale daqui para frente; o que você já registrou não muda. As corridas do dia vêm do plano de corrida — os itens de corrida aqui só indicam dia e período." }));

  for (let k = 0; k < 7; k++) {
    const dia = (pds + k) % 7;
    const doDia = itens.filter((i) => i.diaSemana === dia);
    container.appendChild(card([
      el("p", { class: "eyebrow", text: NOMES_DIA[dia] }),
      doDia.length
        ? el("div", { class: "agenda-lista" }, doDia.map((i) =>
            el("div", { class: "editor-item" }, [
              el("button", { type: "button", class: "editor-item__info", onClick: () => sheetItem(i) }, [
                el("span", { class: "agenda-linha__periodo", text: ROTULO_PERIODO[i.periodo] }),
                el("span", { class: "agenda-linha__titulo", text: textoItem(i) }),
              ]),
              botao("Editar", { variante: "ghost", onClick: () => sheetItem(i) }),
            ])))
        : el("p", { class: "sub", text: "Nada previsto." }),
    ]));
  }

  container.appendChild(botao("+ Adicionar atividade", { variante: "primary", bloco: true, onClick: () => sheetItem(null) }));
}

/** Folha de criar/editar um item. */
function sheetItem(item) {
  const novo = !item;
  let tipo = item ? item.tipo : "musculacao";

  const dia = seletorBotoes(
    [1, 2, 3, 4, 5, 6, 0].map((d) => ({ valor: d, rotulo: CURTO_DIA[d] })),
    { valorInicial: item ? item.diaSemana : 1, colunas: 7 }
  );
  const periodo = segmentos(
    [{ valor: "manha", rotulo: "Manhã" }, { valor: "noite", rotulo: "Noite" }],
    { valorInicial: item ? item.periodo : "manha" }
  );
  const inRotulo = el("input", { type: "text", id: "ag-rotulo", placeholder: "ou escreva um rótulo" });
  const caixaRotulos = el("div", {});
  let rotulos;
  function desenharRotulos(inicial) {
    const ops = ROTULOS_SUGERIDOS[tipo].map((r) => ({ valor: r, rotulo: r }));
    const sugerido = ops.some((o) => o.valor === inicial);
    rotulos = seletorBotoes(ops, { valorInicial: sugerido ? inicial : (inicial ? null : ops[0].valor), onChange: () => { inRotulo.value = ""; } });
    inRotulo.value = sugerido || !inicial ? "" : inicial;
    caixaRotulos.replaceChildren(rotulos.node);
  }
  const tipoSel = segmentos(
    Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => ({ valor, rotulo })),
    { valorInicial: tipo, onChange: (v) => { tipo = v; desenharRotulos(null); } }
  );
  desenharRotulos(item ? item.rotulo : null);
  const opcional = seletorBotoes(
    [{ valor: false, rotulo: "Obrigatório" }, { valor: true, rotulo: "Opcional" }],
    { valorInicial: item ? !!item.opcional : false }
  );
  const erro = el("p", { class: "erro" });

  const salvar = botao(novo ? "Adicionar" : "Salvar", {
    variante: "primary", bloco: true, onClick: async () => {
      const rotulo = inRotulo.value.trim() || rotulos.get();
      if (!rotulo) { erro.textContent = "Escolha ou escreva um rótulo."; return; }
      salvar.disabled = true;
      try {
        await salvarItemAgenda({
          ...(item || {}), diaSemana: dia.get(), periodo: periodo.get(), tipo, rotulo, opcional: opcional.get(),
        });
        fechar();
        toast(novo ? "Atividade adicionada." : "Atividade salva.");
        recarregar();
      } catch (e) {
        salvar.disabled = false;
        erro.textContent = e.message;
      }
    },
  });
  const remover = novo ? null : botao("Remover da agenda", {
    variante: "perigo", bloco: true, onClick: async () => {
      await removerItemAgenda(item);
      fechar();
      toast("Atividade removida.");
      recarregar();
    },
  });

  const fechar = abrirSheet(novo ? "Nova atividade" : "Editar atividade", el("div", { class: "stack" }, [
    el("div", { class: "campo" }, [el("label", { text: "Dia" }), dia.node]),
    periodo.node,
    tipoSel.node,
    el("div", { class: "campo" }, [el("label", { text: "Rótulo" }), caixaRotulos, inRotulo]),
    opcional.node,
    erro,
    el("div", { class: "lista-acoes" }, [salvar, remover]),
  ]));
}
