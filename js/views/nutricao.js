// nutricao.js — aba Nutrição: Refeições (plano, variantes, montar prato, macros,
// busca de substituições, registro) · Semana (proteína) · Orientações.
// Porte do App_Dieta, sem perder recursos.

import {
  PLANO, ROTULO_CURTO, ROTULO_HORA, refeicoes, obterRefeicao, nomeVariante,
  macrosEstimados, refeicaoDoHorario, procurarSubstituicoes, partesDoGrupo,
  resumoDoPrato, carregarDia, carregarSemanas, registrarRefeicao,
} from "../services/nutricao.js";
import { hoje as hojeISO, deISODate, nomeDiaSemana } from "../services/dates.js";
import { irPara, recarregar } from "./router.js";
import { el, card, botao, tituloVista, segmentos, toast } from "./components/ui.js";
import { sheetRefeicao, faixaMeta } from "./components/nutricao-ui.js";

const SEGMENTOS = [
  { valor: "refeicoes", rotulo: "Refeições" },
  { valor: "semana", rotulo: "Semana" },
  { valor: "orientacoes", rotulo: "Orientações" },
];

// Estado da consulta: vive só na memória (sobrevive a recarregar(), some ao
// fechar o app). A refeição inicial é a do horário, como no App_Dieta.
const estado = {
  refeicaoId: null,
  varianteDe: {},          // refeicaoId -> índice da variante exibida
  modo: "alimentos",       // 'alimentos' | 'macros'
  montar: false,
  prato: { refeicaoId: null, varianteIndex: null, escolhas: {} },
  resumoAberto: false,
  termo: "",
};

// A barra do prato é redesenhada quando uma opção muda (cards e vista disparam
// "nutri:prato"). Um único listener, apontado para a barra da tela atual.
let aoMudarPrato = null;
document.addEventListener("nutri:prato", () => { if (aoMudarPrato) aoMudarPrato(); });

export async function renderNutricao(container, param) {
  const seg = SEGMENTOS.some((s) => s.valor === param) ? param : "refeicoes";
  container.appendChild(tituloVista("Nutrição"));
  const seletor = segmentos(SEGMENTOS, { valorInicial: seg, onChange: (v) => irPara("nutricao/" + v) }).node;
  seletor.classList.add("segmentos--cheio");
  container.appendChild(seletor);

  if (seg === "semana") return renderSemana(container);
  if (seg === "orientacoes") return renderOrientacoes(container);
  return renderRefeicoes(container);
}

// ===========================================================================
// Refeições
// ===========================================================================
async function renderRefeicoes(container) {
  if (!estado.refeicaoId) estado.refeicaoId = refeicaoDoHorario(new Date().getHours());
  const dia = await carregarDia(hojeISO());

  // ---- busca de substituições ----
  const busca = el("input", {
    type: "search", id: "nutri-busca", class: "busca", placeholder: "Buscar substituição (ex.: pão, frango)", "aria-label": "Buscar substituição",
    value: estado.termo, autocomplete: "off", enterkeyhint: "search",
  });
  const limparBusca = el("button", { type: "button", class: "btn btn--ghost busca-limpar", "aria-label": "Limpar busca", text: "✕" });
  limparBusca.hidden = !estado.termo;
  busca.addEventListener("input", () => { estado.termo = busca.value; limparBusca.hidden = !busca.value; desenhar(); });
  busca.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { busca.value = ""; estado.termo = ""; limparBusca.hidden = true; desenhar(); busca.blur(); } });
  limparBusca.addEventListener("click", () => { busca.value = ""; estado.termo = ""; limparBusca.hidden = true; desenhar(); busca.focus(); });
  container.appendChild(el("div", { class: "busca-wrap" }, [busca, limparBusca]));

  // ---- abas por refeição ----
  const abas = el("div", { class: "abas-refeicao", role: "tablist", "aria-label": "Refeições" });
  for (const r of refeicoes()) {
    abas.appendChild(el("button", {
      type: "button", role: "tab", class: "aba-refeicao", "aria-selected": String(r.id === estado.refeicaoId),
      onClick: () => {
        estado.refeicaoId = r.id; estado.modo = "alimentos";
        if (estado.termo) { estado.termo = ""; busca.value = ""; limparBusca.hidden = true; }
        for (const b of abas.children) b.setAttribute("aria-selected", String(b === abas.children[refeicoes().indexOf(r)]));
        desenhar(); window.scrollTo(0, 0);
      },
    }, [
      el("span", { text: ROTULO_CURTO[r.id] || r.nome }),
      el("span", { class: "aba-refeicao__hora", text: ROTULO_HORA[r.id] || r.horarioSugerido || "" }),
      dia.porRefeicao[r.id] ? el("span", { class: "aba-refeicao__ok", "aria-label": "feita hoje", text: "✓" }) : null,
    ]));
  }
  container.appendChild(abas);

  const conteudo = el("div", {});
  container.appendChild(conteudo);
  const barra = el("aside", { class: "barra-prato", "aria-label": "Prato montado" });
  container.appendChild(barra);
  container.appendChild(el("p", { class: "rodape-plano", text: `Plano de ${PLANO.versao} · ${PLANO.nutricionista.nome}` }));

  function desenhar() {
    conteudo.replaceChildren(estado.termo.trim() ? vistaBusca() : vistaRefeicao(dia));
    desenharBarra();
  }

  // ---- barra do prato (fixa, só no modo montar) ----
  function desenharBarra() {
    const visivel = estado.montar && !estado.termo.trim() && estado.modo === "alimentos";
    barra.hidden = !visivel;
    if (!visivel) { barra.replaceChildren(); return; }
    const p = estado.prato;
    const r = resumoDoPrato(p.refeicaoId, p.varianteIndex, p.escolhas);
    const topo = el("button", {
      type: "button", class: "barra-prato__topo", "aria-expanded": String(estado.resumoAberto),
      onClick: () => { estado.resumoAberto = !estado.resumoAberto; desenharBarra(); },
    }, [
      el("span", { class: "strong", text: `${r.itens.length} de ${r.total} blocos` }),
      r.pendentes.length ? el("span", { class: "barra-prato__aviso", text: r.pendentes.length === 1 ? "falta 1" : `faltam ${r.pendentes.length}` }) : null,
      el("span", { class: "muted", text: estado.resumoAberto ? "▾" : "▴" }),
    ]);
    const filhos = [topo];
    if (estado.resumoAberto) {
      const lista = el("div", { class: "barra-prato__lista" });
      if (!r.itens.length && !r.pendentes.length) lista.appendChild(el("p", { class: "sub", text: "Nada escolhido ainda." }));
      for (const it of r.itens) {
        lista.appendChild(el("div", { class: "barra-prato__item" }, [
          el("span", { class: "barra-prato__grupo", text: it.grupo }),
          el("span", { text: it.quantidade ? `${it.quantidade} · ${it.alimento}` : it.alimento }),
        ]));
      }
      for (const g of r.pendentes) {
        lista.appendChild(el("div", { class: "barra-prato__item falta" }, [
          el("span", { class: "barra-prato__grupo", text: g }),
          el("span", { text: "falta escolher" }),
        ]));
      }
      filhos.push(lista);
      filhos.push(botao("Limpar seleção", {
        variante: "ghost", bloco: true, onClick: () => { estado.prato.escolhas = {}; desenhar(); },
      }));
    }
    barra.replaceChildren(...filhos);
  }

  aoMudarPrato = desenharBarra;
  desenhar();
}

function vistaRefeicao(dia) {
  const ref = obterRefeicao(estado.refeicaoId) || refeicoes()[0];
  const vi = Math.min(estado.varianteDe[ref.id] || 0, ref.variantes.length - 1);
  const agora = refeicaoDoHorario(new Date().getHours()) === ref.id;
  const registro = dia.porRefeicao[ref.id] || null;

  // trocar de refeição ou de variante descarta o prato montado
  const p = estado.prato;
  if (p.refeicaoId !== ref.id || p.varianteIndex !== vi) {
    estado.prato = { refeicaoId: ref.id, varianteIndex: vi, escolhas: {} };
  }

  const frag = el("div", {});
  frag.appendChild(el("div", { class: "row-between nutri-cab" }, [
    el("h2", { class: "titulo-lg", text: ref.nome }),
    agora ? el("span", { class: "badge badge--concluido", text: "agora" }) : null,
  ]));

  // ---- registro de hoje ----
  if (registro) {
    frag.appendChild(el("div", { class: "registro-feito" }, [
      el("span", { text: `✓ Feita hoje${registro.varianteNome ? " · " + registro.varianteNome : ""} · ≈ ${Math.round((registro.macros?.prot || 0) * registro.fracao)} g de proteína` }),
      botao("Alterar", { variante: "ghost", onClick: () => sheetRefeicao(ref, dia.data, registro) }),
    ]));
  } else {
    frag.appendChild(el("div", { class: "lista-acoes registro-acoes" }, [
      botao("Marcar como feita", {
        variante: "primary", bloco: true, onClick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await registrarRefeicao({ data: dia.data, refeicaoId: ref.id, varianteIndex: vi, escolhas: estado.montar ? estado.prato.escolhas : undefined });
            toast(`${ref.nome} registrada.`);
          } catch (e) { toast("Não foi possível salvar: " + e.message); }
          recarregar();
        },
      }),
      botao("Outra porção…", {
        variante: "ghost", bloco: true,
        onClick: () => sheetRefeicao(ref, dia.data, null, { varianteInicial: vi, escolhas: estado.montar ? estado.prato.escolhas : undefined }),
      }),
    ]));
  }

  // ---- Alimentos / Macros ----
  const modos = segmentos(
    [{ valor: "alimentos", rotulo: "Alimentos" }, { valor: "macros", rotulo: "Macros" }],
    { valorInicial: estado.modo, onChange: (v) => { estado.modo = v; redesenharVista(frag, dia); } }
  );
  frag.appendChild(modos.node);

  // ---- variantes ----
  if (ref.variantes.length > 1) {
    const grupo = el("div", { class: "variantes" });
    ref.variantes.forEach((_, i) => {
      grupo.appendChild(el("button", {
        type: "button", class: "variante", "aria-pressed": i === vi, text: nomeVariante(ref, i),
        onClick: () => { estado.varianteDe[ref.id] = i; redesenharVista(frag, dia); },
      }));
    });
    frag.appendChild(grupo);
  }

  if (estado.modo === "macros") {
    frag.appendChild(cardMacros(ref, vi));
    return frag;
  }

  frag.appendChild(botao(estado.montar ? "Sair do modo montar" : "Montar prato", {
    variante: estado.montar ? "primary" : undefined, bloco: true,
    onClick: () => { estado.montar = !estado.montar; if (!estado.montar) estado.resumoAberto = false; redesenharVista(frag, dia); },
  }));

  ref.variantes[vi].blocos.forEach((bloco, i) => {
    if (i > 0) frag.appendChild(el("div", { class: "mais", "aria-hidden": "true" }, [el("span", { text: "+" })]));
    frag.appendChild(cardBloco(bloco));
  });
  if (ref.observacao) frag.appendChild(el("div", { class: "observacao", text: ref.observacao }));
  if (estado.montar) frag.appendChild(el("div", { class: "espaco-barra" }));
  return frag;
}

/** Redesenha a vista no lugar (sem passar pelo router: preserva o foco e o scroll). */
function redesenharVista(frag, dia) {
  const novo = vistaRefeicao(dia);
  frag.replaceWith(novo);
  // a barra fixa é irmã do conteúdo; o evento abaixo a atualiza
  document.dispatchEvent(new CustomEvent("nutri:prato"));
}

function cardBloco(bloco) {
  const opcoes = [];
  const escolhida = () => estado.prato.escolhas[bloco.grupo];
  const pintar = () => opcoes.forEach(({ op, node }) => node.setAttribute("aria-pressed", String(op === escolhida())));
  const filhos = [
    el("div", { class: "bloco-topo" }, [
      el("span", { class: "bloco-grupo", text: bloco.grupo }),
      bloco.obrigatorio === false ? el("span", { class: "chip-opcional", text: "opcional" }) : null,
    ]),
  ];
  bloco.opcoes.forEach((op, i) => {
    if (i > 0) filhos.push(el("div", { class: "ou", text: "ou" }));
    const conteudoOp = [
      op.quantidade ? el("span", { class: "quantidade", text: op.quantidade }) : null,
      el("span", { class: "alimento", text: op.alimento }),
    ];
    if (estado.montar) {
      const node = el("button", {
        type: "button", class: "opcao opcao--btn",
        onClick: () => {
          if (escolhida() === op) delete estado.prato.escolhas[bloco.grupo];
          else estado.prato.escolhas[bloco.grupo] = op;
          pintar();
          document.dispatchEvent(new CustomEvent("nutri:prato"));
        },
      }, conteudoOp);
      opcoes.push({ op, node });
      filhos.push(node);
    } else {
      filhos.push(el("div", { class: "opcao" }, conteudoOp));
    }
  });
  const node = card(filhos);
  if (estado.montar) pintar();
  return node;
}

function cardMacros(ref, vi) {
  const m = macrosEstimados(ref.id, vi);
  const pk = m.prot * 4, ck = m.carb * 4, gk = m.gord * 9;
  const tot = pk + ck + gk || 1;
  const pct = (x) => `${((x / tot) * 100).toFixed(1)}%`;
  return card([
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "Macros da refeição" }),
      el("span", { class: "selo-estimativa", text: "estimativa" }),
    ]),
    ref.variantes.length > 1 ? el("p", { class: "sub", text: nomeVariante(ref, vi) }) : null,
    el("div", { class: "macro-bar", "aria-hidden": "true" }, [
      el("i", { class: "p", style: { width: pct(pk) } }),
      el("i", { class: "c", style: { width: pct(ck) } }),
      el("i", { class: "g", style: { width: pct(gk) } }),
    ]),
    el("div", { class: "macros-grid" }, [
      macroItem(m.prot, "Proteína", "p"), macroItem(m.carb, "Carboidrato", "c"), macroItem(m.gord, "Gordura", "g"),
    ]),
    el("p", { class: "macro-kcal" }, [el("strong", { text: `≈ ${m.kcal}` }), " kcal"]),
    el("div", { class: "observacao", text: "Estimativa calculada a partir dos alimentos do plano — os valores mudam conforme as opções que você escolher em cada grupo. Não são valores oficiais da nutricionista." }),
  ]);
}
function macroItem(valor, nome, cls) {
  return el("div", { class: `macro-item ${cls}` }, [
    el("div", { class: "macro-val", text: `${valor} g` }),
    el("div", { class: "macro-nome", text: nome }),
  ]);
}

function vistaBusca() {
  const termo = estado.termo.trim();
  const achados = procurarSubstituicoes(termo);
  const frag = el("div", {}, [el("h2", { class: "titulo-lg nutri-cab", text: "Substituições" })]);
  if (!achados.length) {
    frag.appendChild(el("div", { class: "vazio stack" }, [
      el("p", { class: "strong", text: `“${termo}” não está na lista de substituição do plano.` }),
      el("p", { class: "sub", text: "Só vale trocar por itens que aparecem nesta lista — o plano não prevê equivalências fora dela." }),
    ]));
    return frag;
  }
  for (const a of achados) {
    const partes = partesDoGrupo(a.grupo);
    frag.appendChild(card([
      el("div", { class: "bloco-topo" }, [
        el("span", { class: "bloco-grupo", text: partes.titulo }),
        partes.nota ? el("span", { class: "chip-opcional", text: partes.nota }) : null,
      ]),
      ...a.itens.map((item, i) => el("div", { class: `opcao subs${a.casados.includes(i) ? " casa" : ""}` }, [
        el("span", { class: "alimento", text: item.alimento }),
        item.medida ? el("span", { class: "subs-medida", text: item.medida }) : null,
      ])),
      a.nota ? el("div", { class: "observacao", text: a.nota }) : null,
    ]));
  }
  return frag;
}

// ===========================================================================
// Semana (proteína)
// ===========================================================================
const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

async function renderSemana(container) {
  const semanas = await carregarSemanas(4);
  const atual = semanas[0];

  container.appendChild(card([
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "Proteína · esta semana" }),
      el("span", { class: "selo-estimativa", text: "estimativa" }),
    ]),
    el("div", { class: "kpis" }, [
      el("div", { class: "kpi" }, [
        el("div", { class: "n", text: `${atual.diasMeta} de ${atual.diasComRegistro}` }),
        el("div", { class: "r", text: `dias com ≥ ${atual.metaMin} g (dias com registro)` }),
      ]),
      el("div", { class: "kpi" }, [
        el("div", { class: "n", text: atual.media == null ? "—" : `${atual.media} g` }),
        el("div", { class: "r", text: "média por dia registrado" }),
      ]),
    ]),
    atual.diasSemRegistro
      ? el("p", { class: "sub pequeno", text: `${atual.diasSemRegistro} ${atual.diasSemRegistro === 1 ? "dia" : "dias"} sem registro (fora da média).` })
      : null,
    el("div", { class: "dias-proteina" }, atual.dias.map((d) =>
      el("div", { class: `dia-proteina${d.futuro ? " futuro" : ""}` }, [
        el("span", { class: "dia-proteina__dia", text: `${nomeDiaSemana(d.data, true)} ${ddmm(d.data)}` }),
        d.proteina == null
          ? el("span", { class: "muted pequeno", text: d.futuro ? "" : "sem registro" })
          : faixaMeta(d.proteina, atual.metaMin, atual.metaMax),
        el("span", { class: `dia-proteina__valor${d.bateu ? " ok" : ""}`, text: d.proteina == null ? "" : `${Math.round(d.proteina)} g` }),
      ]))),
  ]));

  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Semanas anteriores" }),
    el("div", { class: "mini-lista" }, semanas.slice(1).map((s) =>
      el("div", { class: "mini" }, [
        el("div", { class: "esq" }, [
          el("span", { class: "rotulo", text: `${ddmm(s.inicio)} a ${ddmm(s.fim)}` }),
          el("strong", { text: s.diasComRegistro ? `${s.diasMeta} de ${s.diasComRegistro} dias na meta` : "sem registros" }),
        ]),
        el("span", { class: "dir", text: s.media == null ? "—" : `${s.media} g/dia` }),
      ]))),
  ]));

  container.appendChild(el("p", { class: "sub pequeno", text: "Proteína do dia = soma da estimativa de cada refeição registrada × porção, mais a proteína extra. As estimativas não são valores oficiais da nutricionista." }));
}

// ===========================================================================
// Orientações
// ===========================================================================
async function renderOrientacoes(container) {
  const n = PLANO.nutricionista;
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Do seu plano" }),
    el("p", { class: "citacao", text: PLANO.mensagemAbertura }),
    el("p", { class: "sub", text: `— ${n.nome}, ${n.clinica} · plano de ${PLANO.versao}` }),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Hidratação" }),
    el("p", { text: PLANO.hidratacao }),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Refeição livre" }),
    el("p", { text: PLANO.refeicaoLivre }),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Orientações gerais" }),
    el("ul", { class: "lista-orientacoes" }, PLANO.orientacoes.map((o) => el("li", { text: o }))),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Links e cupons" }),
    el("div", { class: "mini-lista" }, PLANO.links.map((l) =>
      el("a", { class: "mini link-cupom", href: l.url, target: "_blank", rel: "noopener noreferrer" }, [
        el("div", { class: "esq" }, [
          el("strong", { text: l.nome }),
          el("span", { class: "rotulo", text: `cupom ${l.cupom} · ${l.desconto}` }),
        ]),
        el("span", { class: "dir", text: "↗" }),
      ]))),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Contato" }),
    el("p", { class: "strong", text: `${n.nome} · ${n.clinica}` }),
    el("p", { class: "sub", text: [n.telefone && `Tel. ${n.telefone}`, n.whatsapp && `WhatsApp ${n.whatsapp}`, n.email, n.instagram].filter(Boolean).join(" · ") }),
    n.endereco ? el("p", { class: "sub", text: n.endereco }) : null,
  ]));
}
