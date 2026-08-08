// ui.js — helpers de criação de DOM. Sem innerHTML com dados do usuário:
// tudo por textContent/createElement. Camada de view (components).

/**
 * Cria um elemento. props aceita: class, text, html(SÓ estático de confiança),
 * atributos (id, href, type, ...), on{Event}, dataset, e style.
 * children: nó, string, ou array deles.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // usar só com conteúdo estático (ex.: ícone SVG fixo)
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

/** Remove todos os filhos de um nó. */
export function limpar(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Botão. variante: 'primary' | 'ghost' | undefined. */
export function botao(texto, { onClick, variante, bloco, grande, disabled, id } = {}) {
  const classes = ["btn"];
  if (variante === "primary") classes.push("btn--primary");
  if (variante === "ghost") classes.push("btn--ghost");
  if (bloco) classes.push("btn--block");
  if (grande) classes.push("btn--grande");
  return el("button", { class: classes.join(" "), text: texto, onClick, disabled, id, type: "button" });
}

/** Cartão container. */
export function card(children, { accent } = {}) {
  return el("section", { class: accent ? "card card--accent" : "card" }, children);
}

/** Estado vazio com texto útil (sem ilustração, sem frase motivacional). */
export function estadoVazio(titulo, texto) {
  return el("div", { class: "vazio stack" }, [
    el("p", { class: "titulo-lg", text: titulo }),
    texto ? el("p", { class: "sub", text: texto }) : null,
  ]);
}

/** Item de metadado (rótulo em cima, valor grande embaixo). */
export function metaItem(rotulo, valor) {
  return el("div", { class: "metaitem" }, [
    el("span", { class: "rotulo", text: rotulo }),
    el("span", { class: "valor", text: valor }),
  ]);
}

/** Bloco da estrutura (aquecimento/principal/desaquecimento). */
export function blocoEstrutura(k, v) {
  return el("div", { class: "bloco" }, [
    el("span", { class: "k", text: k }),
    el("span", { class: "v", text: v }),
  ]);
}

/** Barra de progresso 0..1. */
export function barraProgresso(fracao) {
  const f = Math.max(0, Math.min(1, fracao || 0));
  return el("div", { class: "progresso" }, [el("i", { style: { width: `${f * 100}%` } })]);
}

/** Toast efêmero no rodapé. */
export function toast(mensagem, ms = 2600) {
  const t = el("div", { class: "update-banner", role: "status" }, [el("span", { text: mensagem })]);
  t.style.background = "var(--ink)";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Título de seção/vista. */
export function tituloVista(texto) {
  return el("h1", { class: "view-titulo", text: texto });
}

/** Cabeçalho de tela cheia com botão voltar. */
export function cabecalhoVoltar(titulo, onVoltar) {
  return el("div", { class: "topbar" }, [
    el("button", {
      class: "btn btn--ghost topbar__voltar", type: "button", "aria-label": "Voltar",
      onClick: onVoltar, html: "&#8592;",
    }),
    el("h1", { class: "topbar__titulo", text: titulo }),
  ]);
}

/** Campo de formulário (rótulo + input + ajuda opcional + área de erro). */
export function campo(rotulo, inputNode, ajuda) {
  return el("div", { class: "campo" }, [
    inputNode.id ? el("label", { for: inputNode.id, text: rotulo }) : el("label", { text: rotulo }),
    inputNode,
    ajuda ? el("p", { class: "ajuda", text: ajuda }) : null,
  ]);
}

/**
 * Grupo de botões de seleção única (RPE, sensação, etc.).
 * opcoes: [{valor, rotulo}]. Devolve {node, get, set}.
 */
export function seletorBotoes(opcoes, { valorInicial = null, onChange, colunas } = {}) {
  let valor = valorInicial;
  const botoes = new Map();
  const node = el("div", { class: "seletor" + (colunas ? " seletor--grid" : "") });
  if (colunas) node.style.gridTemplateColumns = `repeat(${colunas}, 1fr)`;
  for (const op of opcoes) {
    const b = el("button", {
      class: "seletor__op", type: "button", text: op.rotulo,
      "aria-pressed": valor === op.valor,
      onClick: () => { set(op.valor); if (onChange) onChange(op.valor); },
    });
    botoes.set(op.valor, b);
    node.appendChild(b);
  }
  function set(v) {
    valor = v;
    for (const [k, b] of botoes) b.setAttribute("aria-pressed", k === v);
  }
  return { node, get: () => valor, set };
}

/** Bottom sheet / modal simples. Devolve função para fechar. */
export function abrirSheet(titulo, conteudo) {
  const anterior = document.querySelector(".sheet-overlay");
  if (anterior) anterior.remove();
  const fechar = () => overlay.remove();
  const painel = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "sheet__grip" }),
    el("div", { class: "row-between", style: { marginBottom: "8px" } }, [
      el("h2", { class: "titulo-lg", text: titulo }),
      el("button", { class: "btn btn--ghost", type: "button", "aria-label": "Fechar", html: "&#10005;", onClick: fechar }),
    ]),
    conteudo,
  ]);
  const overlay = el("div", { class: "sheet-overlay", onClick: (e) => { if (e.target === overlay) fechar(); } }, [painel]);
  document.body.appendChild(overlay);
  return fechar;
}

/** Segmented control (seletor de período/visão). opcoes: [{valor,rotulo}]. */
export function segmentos(opcoes, { valorInicial, onChange } = {}) {
  let valor = valorInicial ?? opcoes[0].valor;
  const botoes = new Map();
  const node = el("div", { class: "segmentos" });
  for (const op of opcoes) {
    const b = el("button", {
      class: "segmentos__op", type: "button", text: op.rotulo,
      "aria-pressed": valor === op.valor,
      onClick: () => { valor = op.valor; for (const [k, x] of botoes) x.setAttribute("aria-pressed", k === valor); if (onChange) onChange(valor); },
    });
    botoes.set(op.valor, b);
    node.appendChild(b);
  }
  return { node, get: () => valor };
}
