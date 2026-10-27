// nutricao-ui.js — cards e folhas de registro alimentar. Usado em Hoje e em
// Nutrição. As macros são estimativas e a interface sempre diz isso.

import { recarregar, irPara } from "../router.js";
import {
  refeicoes, nomeVariante, macrosEstimados, refeicaoDoHorario,
  registrarRefeicao, registrarProteinaExtra, desfazerRegistro, ultimaVariante,
  FRACOES, ROTULO_CURTO, ROTULO_HORA,
} from "../../services/nutricao.js";
import { el, botao, abrirSheet, seletorBotoes, toast, campo } from "./ui.js";

const fmtG = (n) => `${Math.round(n)} g`;

async function agir(fn) {
  try { await fn(); }
  catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
  await recarregar();
}

/** Barra com a faixa-alvo sombreada e o valor atual. */
export function faixaMeta(valor, min, max) {
  const escala = Math.max(max * 1.15, valor * 1.05, 1);
  const pct = (v) => `${Math.min(100, (v / escala) * 100)}%`;
  return el("div", { class: "faixa-meta", role: "img", "aria-label": `${Math.round(valor)} de ${min} a ${max}` }, [
    el("i", { class: "faixa-meta__alvo", style: { left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` } }),
    el("i", { class: `faixa-meta__valor${valor >= min ? " ok" : ""}`, style: { width: pct(valor) } }),
  ]);
}

// ---------------------------------------------------------------------------
// Card: proteína do dia
// ---------------------------------------------------------------------------
export function cardProteina(dia) {
  const { totais, metas, extras } = dia;
  const p = totais.proteina;
  const situacao = p >= metas.proteinaMinG
    ? (p > metas.proteinaMaxG ? "acima da faixa" : "dentro da faixa")
    : `faltam ${fmtG(metas.proteinaMinG - p)} para o mínimo`;
  return el("section", { class: "card" }, [
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "Proteína hoje" }),
      el("span", { class: "selo-estimativa", text: "estimativa" }),
    ]),
    el("div", { class: "proteina-topo" }, [
      el("span", { class: "numero-grande", text: String(Math.round(p)) }),
      el("span", { class: "muted", text: `g de ${metas.proteinaMinG}–${metas.proteinaMaxG} g` }),
    ]),
    faixaMeta(p, metas.proteinaMinG, metas.proteinaMaxG),
    el("p", { class: "sub pequeno", style: { marginTop: "8px" }, text:
      `${situacao} · refeições ${fmtG(totais.proteinaRefeicoes)}${totais.proteinaExtra ? ` + extra ${fmtG(totais.proteinaExtra)}` : ""} · ≈ ${totais.kcal} kcal` }),
    extras.length
      ? el("div", { class: "extras-lista" }, extras.map((x) =>
          el("div", { class: "extra-item" }, [
            el("span", { text: `+${fmtG(x.proteinaG)}${x.descricao ? " · " + x.descricao : ""}` }),
            el("button", {
              type: "button", class: "btn btn--ghost extra-item__x", "aria-label": "Remover lançamento", text: "✕",
              onClick: () => agir(() => desfazerRegistro(x)),
            }),
          ])))
      : null,
    el("div", { class: "agenda-acoes" }, [
      botao("+ Proteína extra", { variante: "ghost", onClick: () => sheetProteinaExtra(dia.data) }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Card: refeições do dia (a do horário em destaque)
// ---------------------------------------------------------------------------
export function cardRefeicoesHoje(dia, { hora = new Date().getHours() } = {}) {
  const agora = refeicaoDoHorario(hora);
  const linhas = refeicoes().map((ref) => linhaRefeicao(ref, dia, ref.id === agora));
  return el("section", { class: "card" }, [
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "Refeições" }),
      el("button", { type: "button", class: "link-sutil", text: "Ver plano", onClick: () => irPara("nutricao/refeicoes") }),
    ]),
    el("div", { class: "agenda-lista" }, linhas),
  ]);
}

function linhaRefeicao(ref, dia, ehAgora) {
  const reg = dia.porRefeicao[ref.id] || null;
  const partes = [];
  if (reg) {
    if (reg.varianteNome) partes.push(reg.varianteNome);
    if (reg.fracao !== 1) partes.push((FRACOES.find((f) => f.valor === reg.fracao) || {}).rotulo || `${reg.fracao}×`);
    partes.push(`${fmtG((reg.macros?.prot || 0) * reg.fracao)} de proteína`);
  } else {
    partes.push(ROTULO_HORA[ref.id]);
  }
  const marcar = () => agir(async () => {
    if (reg) await desfazerRegistro(reg);
    else await registrarRefeicao({ data: dia.data, refeicaoId: ref.id });
  });
  return el("div", { class: `agenda-linha${reg ? " agenda-linha--feito" : ""}${ehAgora ? " agenda-linha--agora" : ""}` }, [
    el("div", { class: "agenda-linha__topo" }, [
      el("button", { type: "button", class: "agenda-linha__info", onClick: () => sheetRefeicao(ref, dia.data, reg) }, [
        el("span", { class: "agenda-linha__periodo", text: ehAgora ? "Agora" : ROTULO_CURTO[ref.id] }),
        el("span", { class: "agenda-linha__titulo", text: ref.nome }),
        el("span", { class: "agenda-linha__sub", text: partes.join(" · ") }),
      ]),
      el("div", { class: "check3" }, [
        el("button", {
          type: "button", class: "check3__op check3__op--feito", text: "✓",
          "aria-pressed": !!reg, "aria-label": reg ? `Desfazer ${ref.nome}` : `${ref.nome} feita`,
          onClick: (ev) => { ev.currentTarget.disabled = true; marcar(); },
        }),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Folhas
// ---------------------------------------------------------------------------

/** Variante e porção da refeição. `escolhas` vem do montar prato (opcional). */
export async function sheetRefeicao(ref, data, registro, { varianteInicial, escolhas } = {}) {
  const vi = varianteInicial ?? (registro ? registro.varianteIndex : await ultimaVariante(ref.id));
  const variantes = ref.variantes.length > 1
    ? seletorBotoes(ref.variantes.map((_, i) => ({ valor: i, rotulo: nomeVariante(ref, i) })), { valorInicial: vi, onChange: atualizar })
    : null;
  const fracao = seletorBotoes(FRACOES, { valorInicial: registro ? registro.fracao : 1, colunas: 4, onChange: atualizar });
  const estimativa = el("p", { class: "sub" });
  function atualizar() {
    const m = macrosEstimados(ref.id, variantes ? variantes.get() : 0);
    const f = fracao.get() || 1;
    estimativa.textContent = `≈ ${Math.round(m.prot * f)} g de proteína · ${Math.round(m.kcal * f)} kcal (estimativa)`;
  }
  atualizar();

  const salvar = botao(registro ? "Salvar" : "Marcar como feita", {
    variante: "primary", bloco: true, onClick: async () => {
      salvar.disabled = true;
      fechar();
      await agir(() => registrarRefeicao({
        data, refeicaoId: ref.id, varianteIndex: variantes ? variantes.get() : 0, fracao: fracao.get() || 1, escolhas,
      }));
    },
  });
  const desfazer = registro
    ? botao("Desfazer registro", { variante: "ghost", bloco: true, onClick: async () => { fechar(); await agir(() => desfazerRegistro(registro)); } })
    : null;

  const fechar = abrirSheet(ref.nome, el("div", { class: "stack" }, [
    variantes ? el("div", { class: "campo" }, [el("label", { text: "Opção" }), variantes.node]) : null,
    el("div", { class: "campo" }, [el("label", { text: "Quanto você comeu" }), fracao.node]),
    estimativa,
    el("div", { class: "lista-acoes" }, [salvar, desfazer]),
  ]));
}

/** Proteína fora do plano, em gramas. */
export function sheetProteinaExtra(data) {
  const inG = el("input", { type: "number", id: "px-g", inputmode: "numeric", min: "1", step: "1", placeholder: "ex.: 25" });
  const inDesc = el("input", { type: "text", id: "px-desc", placeholder: "ex.: shake de whey (opcional)" });
  const rapidos = el("div", { class: "chips" }, [10, 20, 25, 30].map((g) =>
    el("button", { type: "button", class: "chip", text: `${g} g`, onClick: () => { inG.value = String(g); } })));
  const erro = el("p", { class: "erro" });
  const salvar = botao("Adicionar", {
    variante: "primary", bloco: true, onClick: async () => {
      const g = Number(String(inG.value).replace(",", "."));
      if (!(g > 0)) { erro.textContent = "Informe os gramas de proteína."; return; }
      salvar.disabled = true;
      fechar();
      await agir(() => registrarProteinaExtra({ data, proteinaG: g, descricao: inDesc.value.trim() }));
    },
  });
  const fechar = abrirSheet("Proteína extra", el("div", { class: "stack" }, [
    el("p", { class: "sub", text: "Algo fora do plano, como um shake. Soma direto na proteína do dia." }),
    campo("Proteína (g)", inG),
    rapidos,
    campo("Descrição", inDesc),
    erro,
    salvar,
  ]));
  setTimeout(() => inG.focus(), 50);
}

