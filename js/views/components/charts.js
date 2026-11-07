// charts.js — gráficos SVG da Evolução, feitos à mão. Sem bibliotecas.
// Cada coluna é uma semana do plano, com as mesmas posições em todos os gráficos.
// Tocar numa semana mostra o valor dela num balão.

import { el } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const W = 326, H = 156;
const M = { top: 12, right: 8, bottom: 26, left: 36 };
const BASE = H - M.bottom;

function svgEl(tag, attrs = {}, texto = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (texto != null) n.textContent = texto;
  return n;
}

const larguraSemana = (n) => (W - M.left - M.right) / n;
const xDe = (i, n) => M.left + larguraSemana(n) * (i + 0.5);

function novoSvg(altura, descricao) {
  return svgEl("svg", { viewBox: `0 0 ${W} ${altura}`, role: "group", "aria-label": descricao });
}

/** Rótulos das semanas: a atual em destaque; com muitas semanas, só algumas. */
function rotulosSemanas(svg, semanas, atual, y) {
  const passo = Math.ceil(semanas.length / 8);
  const iAtual = semanas.indexOf(atual);
  semanas.forEach((s, i) => {
    const eAtual = i === iAtual;
    if (!eAtual && passo > 1 && (i % passo !== 0 || (iAtual >= 0 && Math.abs(i - iAtual) < 2))) return;
    svg.appendChild(svgEl("text", {
      class: `grafico__rotulo grafico__rotulo--meio${eAtual ? " grafico__rotulo--atual" : ""}`, x: xDe(i, semanas.length), y,
    }, `S${s}`));
  });
}

function grade(svg, marcas) {
  for (const { y, texto } of marcas) {
    svg.appendChild(svgEl("line", { class: "grafico__eixo", x1: M.left, x2: W - M.right, y1: y, y2: y }));
    svg.appendChild(svgEl("text", { class: "grafico__rotulo grafico__rotulo--fim", x: M.left - 6, y: y + 4 }, texto));
  }
}

/** Área de toque de cada semana e o balão com o valor. `pontos` = [{i, y, texto}]. */
function ativarToque(svg, n, altura, pontos) {
  const fundo = svgEl("rect", { class: "grafico__balao-fundo", y: 0, height: 20, rx: 6 });
  const guia = svgEl("line", { class: "grafico__balao-guia", y1: 20 });
  const texto = svgEl("text", { class: "grafico__balao-texto", y: 14 });
  const balao = svgEl("g", { class: "grafico__balao", visibility: "hidden" });
  balao.append(guia, fundo, texto);

  const mostrar = ({ i, y, texto: conteudo }) => {
    texto.textContent = conteudo;
    balao.setAttribute("visibility", "visible");
    const largura = texto.getComputedTextLength() + 16;
    const x = xDe(i, n);
    const esq = Math.max(0, Math.min(W - largura, x - largura / 2));
    fundo.setAttribute("x", esq);
    fundo.setAttribute("width", largura);
    texto.setAttribute("x", esq + largura / 2);
    guia.setAttribute("x1", x);
    guia.setAttribute("x2", x);
    guia.setAttribute("y2", Math.max(20, y));
  };

  const larg = larguraSemana(n);
  for (const p of pontos) {
    const alvo = svgEl("rect", {
      class: "grafico__toque", x: xDe(p.i, n) - larg / 2, y: 0, width: larg, height: altura,
      tabindex: 0, role: "button", "aria-label": p.texto,
    });
    alvo.addEventListener("click", () => mostrar(p));
    alvo.addEventListener("focus", () => mostrar(p));
    svg.appendChild(alvo);
  }
  svg.appendChild(balao);
}

/** Barra com o topo arredondado e a base reta. */
function barra(classe, x, topo, largura) {
  const r = Math.min(4, largura / 2, BASE - topo);
  return svgEl("path", {
    class: classe,
    d: `M${x} ${BASE}V${topo + r}Q${x} ${topo} ${x + r} ${topo}H${x + largura - r}Q${x + largura} ${topo} ${x + largura} ${topo + r}V${BASE}Z`,
  });
}

/** Minutos feitos sobre os planejados. linhas: {semana, minutos, minutosPlanejados}[]. */
export function graficoVolume(linhas, atual) {
  const n = linhas.length;
  const maior = Math.max(1, ...linhas.flatMap((l) => [l.minutos, l.minutosPlanejados]));
  const passo = [10, 20, 30, 50, 100, 200].find((p) => maior / p <= 4) || 500;
  const topo = maior * 1.08;
  const y = (v) => BASE - (v / topo) * (BASE - M.top);

  const svg = novoSvg(H, "Minutos feitos e planejados por semana");
  const marcas = [];
  for (let v = 0; v <= topo; v += passo) marcas.push({ y: y(v), texto: String(v) });
  grade(svg, marcas);

  const largura = Math.min(20, larguraSemana(n) * 0.6);
  linhas.forEach((l, i) => {
    const x = xDe(i, n) - largura / 2;
    if (l.minutosPlanejados > 0) svg.appendChild(barra("grafico__barra-plano", x, y(l.minutosPlanejados), largura));
    if (l.minutos > 0) svg.appendChild(barra("grafico__barra", x, y(l.minutos), largura));
  });
  rotulosSemanas(svg, linhas.map((l) => l.semana), atual, H - 6);
  ativarToque(svg, n, H, linhas.map((l, i) => ({
    i,
    y: y(Math.max(l.minutos, l.minutosPlanejados)),
    texto: l.semana > atual
      ? `S${l.semana} · ${l.minutosPlanejados} min planejados`
      : `S${l.semana} · ${l.minutos} de ${l.minutosPlanejados} min`,
  })));
  return svg;
}

/** Um quadrado por treino da semana. linhas: {semana, concluidos, planejados}[]. */
export function graficoAderencia(linhas, atual) {
  const n = linhas.length;
  const lado = Math.min(12, larguraSemana(n) - 3);
  const vao = 4;
  const colunas = Math.max(1, ...linhas.map((l) => l.planejados));
  const alturaQuadrados = colunas * lado + (colunas - 1) * vao;
  const altura = alturaQuadrados + 26;

  const svg = novoSvg(altura, "Treinos feitos por semana");
  linhas.forEach((l, i) => {
    for (let q = 0; q < l.planejados; q++) {
      const classe = q < l.concluidos
        ? "grafico__quadrado"
        : l.semana > atual ? "grafico__quadrado-futuro" : "grafico__quadrado-vazio";
      svg.appendChild(svgEl("rect", {
        class: classe, x: xDe(i, n) - lado / 2, y: alturaQuadrados - lado - q * (lado + vao), width: lado, height: lado, rx: 3,
      }));
    }
  });
  rotulosSemanas(svg, linhas.map((l) => l.semana), atual, altura - 6);
  ativarToque(svg, n, altura, linhas.map((l, i) => ({
    i,
    y: alturaQuadrados - l.planejados * (lado + vao),
    texto: `S${l.semana} · ${l.concluidos} de ${l.planejados} treinos`,
  })));
  return svg;
}

/** Limites do eixo em múltiplos de `passo`, incluindo os valores e a faixa de meta. */
function dominioDe(valores, passo, faixa) {
  const todos = faixa ? [...valores, faixa.de, faixa.ate] : valores;
  const min = Math.floor(Math.min(...todos) / passo) * passo;
  let max = Math.ceil(Math.max(...todos) / passo) * passo;
  if (max === min) max = min + passo;
  return [min, max];
}

/**
 * Linha por semana. linhas: {semana, valor|null}[]; semana sem valor vira lacuna.
 * opts: passo do eixo, formatar(v), dominio fixo, inverter (menor valor no alto),
 * faixa {de, ate, rotulo} de meta.
 */
export function graficoLinha(linhas, atual, { passo, formatar, formatarEixo = formatar, dominio, inverter = false, faixa, descricao }) {
  const n = linhas.length;
  const pontos = linhas.map((l, i) => ({ i, valor: l.valor, semana: l.semana })).filter((p) => p.valor != null);
  const [min, max] = dominio || dominioDe(pontos.map((p) => p.valor), passo, faixa);
  const alturaUtil = BASE - M.top;
  const fracao = (v) => (v - min) / (max - min);
  const y = (v) => (inverter ? M.top + fracao(v) * alturaUtil : BASE - fracao(v) * alturaUtil);

  const svg = novoSvg(H, descricao);
  if (faixa) {
    const y1 = y(faixa.de), y2 = y(faixa.ate);
    const topoFaixa = Math.min(y1, y2), alturaFaixa = Math.abs(y1 - y2);
    svg.appendChild(svgEl("rect", { class: "grafico__faixa", x: M.left, y: topoFaixa, width: W - M.left - M.right, height: alturaFaixa }));
    const yRotulo = alturaFaixa >= 18 ? topoFaixa + alturaFaixa - 6 : topoFaixa + alturaFaixa + 14;
    svg.appendChild(svgEl("text", { class: "grafico__rotulo", x: M.left + 6, y: yRotulo }, faixa.rotulo));
  }

  let p = passo;
  while ((max - min) / p > 4) p *= 2;
  const marcas = [];
  for (let v = min; v <= max; v += p) marcas.push({ y: y(v), texto: formatarEixo(v) });
  grade(svg, marcas);

  let d = "";
  let anterior = null;
  for (const ponto of pontos) {
    d += `${anterior != null && ponto.i === anterior + 1 ? "L" : "M"}${xDe(ponto.i, n).toFixed(1)} ${y(ponto.valor).toFixed(1)}`;
    anterior = ponto.i;
  }
  svg.appendChild(svgEl("path", { class: "grafico__linha", d }));
  for (const ponto of pontos) svg.appendChild(svgEl("circle", { class: "grafico__ponto", cx: xDe(ponto.i, n), cy: y(ponto.valor), r: n > 12 ? 3 : 5 }));

  // valor do último ponto: à direita dele, ou acima/abaixo quando encosta na borda
  const ultimo = pontos[pontos.length - 1];
  const xU = xDe(ultimo.i, n), yU = y(ultimo.valor);
  const penultimo = pontos[pontos.length - 2];
  if (xU < W - 60) {
    svg.appendChild(svgEl("text", { class: "grafico__valor", x: xU + 10, y: yU + 4 }, formatar(ultimo.valor)));
  } else {
    const abaixo = (penultimo && y(penultimo.valor) < yU && yU + 18 < BASE) || yU - 10 < 12;
    svg.appendChild(svgEl("text", { class: "grafico__valor grafico__rotulo--fim", x: Math.min(W - 2, xU + 10), y: abaixo ? yU + 18 : yU - 10 }, formatar(ultimo.valor)));
  }

  rotulosSemanas(svg, linhas.map((l) => l.semana), atual, H - 6);
  ativarToque(svg, n, H, pontos.map((ponto) => ({
    i: ponto.i, y: y(ponto.valor), texto: `S${ponto.semana} · ${formatar(ponto.valor)}`,
  })));
  return svg;
}

/**
 * Cartão de um gráfico: título, número atual com a semana a que se refere, legenda
 * e o gráfico. Sem `svg`, mostra `vazio` no lugar dele.
 */
export function blocoGrafico({ titulo, sub, valor, semana, legenda, svg, vazio }) {
  return el("section", { class: "card grafico" }, [
    el("div", { class: "grafico__topo" }, [
      el("div", { class: "grafico__titulos" }, [
        el("h3", { class: "grafico__titulo", text: titulo }),
        sub ? el("span", { class: "grafico__sub", text: sub }) : null,
      ]),
      svg ? el("div", { class: "grafico__atual" }, [
        el("span", { class: "grafico__num", text: valor }),
        el("span", { class: "grafico__sub", text: `Semana ${semana}` }),
      ]) : null,
    ]),
    legenda ? el("div", { class: "grafico__legenda" }, legenda.map(([classe, texto]) =>
      el("span", {}, [el("i", { class: classe }), texto]))) : null,
    svg || el("p", { class: "grafico__vazio", text: vazio }),
  ]);
}
