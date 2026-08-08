// charts.js — gráficos SVG de linha e barra, feitos à mão. Sem dependências.
// Recebe arrays de números (null = sem dado, vira lacuna na linha / barra vazia).

const NS = "http://www.w3.org/2000/svg";
const W = 320, H = 140;
const M = { top: 10, right: 6, bottom: 18, left: 6 };

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function moldura(rotulosX) {
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const base = H - M.bottom;
  svg.appendChild(svgEl("line", { class: "eixo", x1: M.left, y1: base, x2: W - M.right, y2: base }));
  // rótulos X esparsos (primeiro, meio, último)
  if (rotulosX && rotulosX.length) {
    const idxs = [0, Math.floor((rotulosX.length - 1) / 2), rotulosX.length - 1];
    const innerW = W - M.left - M.right;
    for (const i of new Set(idxs)) {
      const x = M.left + (rotulosX.length === 1 ? innerW / 2 : (innerW * i) / (rotulosX.length - 1));
      const t = svgEl("text", { class: "rotulo-x", x, y: H - 5, "text-anchor": "middle" });
      t.textContent = rotulosX[i];
      svg.appendChild(t);
    }
  }
  return { svg, base };
}

function temDado(valores) {
  return valores.some((v) => v != null && !Number.isNaN(v));
}

function vazio() {
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const t = svgEl("text", { class: "vazio-msg", x: W / 2, y: H / 2, "text-anchor": "middle" });
  t.textContent = "sem dados no período";
  svg.appendChild(t);
  return svg;
}

function escalaY(valores, { base, forcarZero }) {
  const nums = valores.filter((v) => v != null && !Number.isNaN(v));
  let min = Math.min(...nums), max = Math.max(...nums);
  if (forcarZero) min = 0;
  if (min === max) { max = min + 1; min = forcarZero ? 0 : min - 1; }
  const top = M.top, innerH = base - top;
  return (v) => base - ((v - min) / (max - min)) * innerH;
}

function xDe(i, n) {
  const innerW = W - M.left - M.right;
  return M.left + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
}

/** Gráfico de linha. valores: (number|null)[]. */
export function graficoLinha(valores, { rotulosX } = {}) {
  if (!temDado(valores)) return vazio();
  const { svg, base } = moldura(rotulosX);
  const y = escalaY(valores, { base, forcarZero: false });
  const n = valores.length;

  // segmentos contínuos (quebra em null)
  let d = "";
  let iniciando = true;
  valores.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) { iniciando = true; return; }
    const cmd = iniciando ? "M" : "L";
    d += `${cmd}${xDe(i, n).toFixed(1)},${y(v).toFixed(1)} `;
    iniciando = false;
  });
  svg.appendChild(svgEl("path", { class: "linha", d: d.trim() }));
  valores.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    svg.appendChild(svgEl("circle", { class: "ponto", cx: xDe(i, n), cy: y(v), r: 2.5 }));
  });
  return svg;
}

/** Gráfico de barras. valores: (number|null)[]. */
export function graficoBarras(valores, { rotulosX } = {}) {
  if (!temDado(valores)) return vazio();
  const { svg, base } = moldura(rotulosX);
  const y = escalaY(valores, { base, forcarZero: true });
  const n = valores.length;
  const innerW = W - M.left - M.right;
  const larguraBarra = Math.max(2, (innerW / n) * 0.62);

  valores.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    const cx = xDe(i, n);
    const topo = y(v);
    svg.appendChild(svgEl("rect", {
      class: "barra", x: cx - larguraBarra / 2, y: topo,
      width: larguraBarra, height: Math.max(0, base - topo), rx: 2,
    }));
  });
  return svg;
}

/** Monta um bloco de gráfico: número grande + rótulo + svg. */
export function blocoGrafico(titulo, valorAtual, svg, unidade = "") {
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const wrap = el("div", "grafico");
  const topo = el("div", "grafico__topo");
  const num = el("div", "grafico__num", valorAtual == null ? "—" : `${valorAtual}${unidade}`);
  topo.appendChild(el("div", "grafico__rot", titulo));
  topo.appendChild(num);
  wrap.appendChild(topo);
  wrap.appendChild(svg);
  return wrap;
}
