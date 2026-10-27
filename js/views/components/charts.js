// charts.js — gráficos SVG de linha e barra, feitos à mão. Sem dependências.
// Recebe arrays de números (null = sem dado, vira lacuna na linha / barra vazia).

import { diffDias, deISODate } from "../../services/dates.js";

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

// ---------------------------------------------------------------------------
// Corpo: peso no tempo e ritmo semanal
// ---------------------------------------------------------------------------

const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const kg = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function texto(svg, attrs, conteudo) {
  const t = svgEl("text", attrs);
  t.textContent = conteudo;
  svg.appendChild(t);
  return t;
}

/**
 * Peso no tempo (eixo X em datas reais).
 * @param {{pontos:{data,peso}[], media:{data,media}[], inbody:{data,pesoKg}[], alvo?:number, de:string, ate:string}} o
 *   pontos: valor diário (pontos pequenos) · media: média móvel 7d (linha) ·
 *   inbody: marcadores (losango) · alvo: linha tracejada de referência
 */
export function graficoPeso({ pontos, media, inbody, alvo, de, ate }) {
  const Hp = 180;
  const Mp = { top: 12, right: 8, bottom: 20, left: 34 };
  const dentro = (d) => d >= de && d <= ate;
  const P = pontos.filter((p) => dentro(p.data));
  const Mm = media.filter((p) => dentro(p.data) && p.media != null);
  const I = inbody.filter((p) => dentro(p.data));
  if (!P.length && !I.length) {
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hp}`, role: "img" });
    texto(svg, { class: "vazio-msg", x: W / 2, y: Hp / 2, "text-anchor": "middle" }, "sem pesagens no período");
    return svg;
  }

  const valores = [...P.map((p) => p.peso), ...Mm.map((p) => p.media), ...I.map((p) => p.pesoKg)];
  if (alvo != null) valores.push(alvo);
  let min = Math.floor(Math.min(...valores) - 0.5), max = Math.ceil(Math.max(...valores) + 0.5);
  if (max - min < 2) { max += 1; min -= 1; }
  const dias = Math.max(1, diffDias(de, ate));
  const x = (data) => Mp.left + ((W - Mp.left - Mp.right) * diffDias(de, data)) / dias;
  const y = (v) => Hp - Mp.bottom - ((v - min) / (max - min)) * (Hp - Mp.top - Mp.bottom);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hp}`, role: "img", "aria-label": "Peso no período" });
  // grade horizontal com 3 marcas
  for (const v of [min, (min + max) / 2, max]) {
    svg.appendChild(svgEl("line", { class: "grade", x1: Mp.left, x2: W - Mp.right, y1: y(v), y2: y(v) }));
    texto(svg, { class: "rotulo-y", x: Mp.left - 4, y: y(v) + 3, "text-anchor": "end" }, kg(v));
  }
  // rótulos X: início, meio, fim
  for (const d of [de, ate]) {
    texto(svg, { class: "rotulo-x", x: x(d), y: Hp - 5, "text-anchor": d === de ? "start" : "end" }, ddmm(d));
  }
  // alvo
  if (alvo != null) {
    svg.appendChild(svgEl("line", { class: "linha-alvo", x1: Mp.left, x2: W - Mp.right, y1: y(alvo), y2: y(alvo) }));
    texto(svg, { class: "rotulo-alvo", x: W - Mp.right - 2, y: y(alvo) - 4, "text-anchor": "end" }, `alvo ${kg(alvo)}`);
  }
  // pontos diários
  for (const p of P) svg.appendChild(svgEl("circle", { class: "ponto-cru", cx: x(p.data), cy: y(p.peso), r: 2.2 }));
  // média móvel
  if (Mm.length) {
    const d = Mm.map((p, i) => `${i ? "L" : "M"}${x(p.data).toFixed(1)},${y(p.media).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { class: "linha", d }));
  }
  // InBody
  for (const p of I) {
    const cx = x(p.data), cy = y(p.pesoKg), r = 5;
    const g = svgEl("path", { class: "marcador-inbody", d: `M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z` });
    const t = svgEl("title");
    t.textContent = `InBody ${ddmm(p.data)}: ${kg(p.pesoKg)} kg`;
    g.appendChild(t);
    svg.appendChild(g);
  }
  return svg;
}

/**
 * Ritmo semanal (perda em kg; positivo = perdeu) com a faixa-alvo sombreada.
 * @param {{semanas:{fim,kgSemana}[], faixa:[number,number]}} o
 */
export function graficoRitmo({ semanas, faixa }) {
  const Hr = 150;
  const Mr = { top: 10, right: 6, bottom: 18, left: 34 };
  const vals = semanas.map((s) => s.kgSemana).filter((v) => v != null);
  if (!vals.length) {
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hr}`, role: "img" });
    texto(svg, { class: "vazio-msg", x: W / 2, y: Hr / 2, "text-anchor": "middle" }, "pesagens insuficientes (2 semanas)");
    return svg;
  }
  let min = Math.min(0, ...vals), max = Math.max(faixa[1] + 0.1, ...vals);
  min = Math.floor(min * 10) / 10; max = Math.ceil(max * 10) / 10;
  const y = (v) => Hr - Mr.bottom - ((v - min) / (max - min)) * (Hr - Mr.top - Mr.bottom);
  const n = semanas.length;
  const larg = (W - Mr.left - Mr.right) / n;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${Hr}`, role: "img", "aria-label": "Ritmo semanal" });
  svg.appendChild(svgEl("rect", { class: "faixa-alvo", x: Mr.left, width: W - Mr.left - Mr.right, y: y(faixa[1]), height: Math.max(1, y(faixa[0]) - y(faixa[1])) }));
  texto(svg, { class: "rotulo-y", x: Mr.left - 4, y: y(faixa[1]) + 3, "text-anchor": "end" }, kg(faixa[1]));
  texto(svg, { class: "rotulo-y", x: Mr.left - 4, y: y(faixa[0]) + 3, "text-anchor": "end" }, kg(faixa[0]));
  svg.appendChild(svgEl("line", { class: "eixo", x1: Mr.left, x2: W - Mr.right, y1: y(0), y2: y(0) }));
  texto(svg, { class: "rotulo-y", x: Mr.left - 4, y: y(0) + 3, "text-anchor": "end" }, "0");

  semanas.forEach((s, i) => {
    const cx = Mr.left + larg * (i + 0.5);
    if (s.kgSemana != null) {
      const topo = Math.min(y(s.kgSemana), y(0));
      svg.appendChild(svgEl("rect", {
        class: s.kgSemana < 0 ? "barra barra--ganho" : "barra",
        x: cx - larg * 0.3, width: larg * 0.6, y: topo, height: Math.max(1, Math.abs(y(s.kgSemana) - y(0))), rx: 2,
      }));
    }
    if (i === 0 || i === n - 1) texto(svg, { class: "rotulo-x", x: cx, y: Hr - 5, "text-anchor": "middle" }, ddmm(s.fim));
  });
  return svg;
}
