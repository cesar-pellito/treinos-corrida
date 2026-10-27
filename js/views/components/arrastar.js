// arrastar.js — segurar e arrastar linhas da agenda entre "vagas" (dia × período).
// Camada de view: só DOM. Quem chama decide o que soltar significa.
//
// Toque: segurar ~0,4 s sem mexer inicia o arrasto (mexer antes = rolar a
// página). Mouse: segurar o botão e mexer alguns pixels. Durante o arrasto a
// página rola sozinha perto das bordas, e as vagas vazias aparecem como alvo.
//
// Estrutura esperada dentro de `raiz`:
//   .slot[data-data][data-periodo]   vaga (dia × período), com as linhas dentro
//   .agenda-linha                    linhas; só as de `linhas` podem ser arrastadas

import { el } from "./ui.js";

const ESPERA_TOQUE_MS = 400;
const TOLERANCIA_TOQUE = 10; // px que o dedo pode tremer antes de virar rolagem
const LIMIAR_MOUSE = 6;
const BORDA_ROLAGEM = 90;    // px a partir da borda (em cima e embaixo) que fazem rolar

/**
 * Ativa o arrasto. `linhas`: Map(nó da linha → contexto qualquer).
 * `aoSoltar({ contexto, data, periodo, indice, vizinhas })` é chamada quando
 * o destino muda algo. `indice` é a posição de inserção entre `vizinhas` (as
 * linhas da vaga de destino, sem a arrastada).
 */
export function ativarArrastar(raiz, { linhas, aoSoltar }) {
  for (const [no, contexto] of linhas) {
    no.classList.add("arrastavel");
    prepararLinha(raiz, no, contexto, aoSoltar);
  }
}

function prepararLinha(raiz, no, contexto, aoSoltar) {
  let pendente = null;   // {x, y, timer}
  let arrasto = null;    // estado durante o arrasto

  // ---- toque ----
  no.addEventListener("touchstart", (ev) => {
    if (ev.touches.length !== 1 || arrasto) return;
    const t = ev.touches[0];
    pendente = {
      x: t.clientX, y: t.clientY,
      timer: setTimeout(() => { pendente = null; arrasto = iniciar(raiz, no, t.clientX, t.clientY); }, ESPERA_TOQUE_MS),
    };
  }, { passive: true });

  // não-passivo: durante o arrasto impede a rolagem nativa
  no.addEventListener("touchmove", (ev) => {
    const t = ev.touches[0];
    if (arrasto) {
      ev.preventDefault();
      mover(arrasto, t.clientX, t.clientY);
    } else if (pendente && Math.hypot(t.clientX - pendente.x, t.clientY - pendente.y) > TOLERANCIA_TOQUE) {
      cancelarPendente();
    }
  }, { passive: false });

  const fimToque = (ev) => {
    cancelarPendente();
    if (!arrasto) return;
    if (ev.cancelable) ev.preventDefault(); // sem clique fantasma ao soltar
    terminar(arrasto, ev.type === "touchend", contexto, aoSoltar);
    arrasto = null;
  };
  no.addEventListener("touchend", fimToque);
  no.addEventListener("touchcancel", fimToque);

  // o toque longo abriria o menu de contexto do navegador
  no.addEventListener("contextmenu", (ev) => ev.preventDefault());

  // ---- mouse ----
  no.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || arrasto) return;
    const x0 = ev.clientX, y0 = ev.clientY;
    const aoMover = (e) => {
      if (!arrasto) {
        if (Math.hypot(e.clientX - x0, e.clientY - y0) < LIMIAR_MOUSE) return;
        arrasto = iniciar(raiz, no, x0, y0);
      }
      e.preventDefault();
      mover(arrasto, e.clientX, e.clientY);
    };
    const aoSoltarMouse = () => {
      window.removeEventListener("mousemove", aoMover);
      window.removeEventListener("mouseup", aoSoltarMouse);
      if (!arrasto) return;
      engolirProximoClique();
      terminar(arrasto, true, contexto, aoSoltar);
      arrasto = null;
    };
    window.addEventListener("mousemove", aoMover);
    window.addEventListener("mouseup", aoSoltarMouse);
  });

  function cancelarPendente() {
    if (pendente) clearTimeout(pendente.timer);
    pendente = null;
  }
}

/** Depois de soltar com o mouse, o clique que se segue não deve acionar botões da linha. */
function engolirProximoClique() {
  const engolir = (e) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener("click", engolir, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", engolir, { capture: true }), 300);
}

function iniciar(raiz, no, x, y) {
  if (navigator.vibrate) navigator.vibrate(12);
  // As vagas vazias aparecem ao entrar no modo de arrasto: compensa a rolagem
  // para a linha não "pular" debaixo do dedo.
  const antes = no.getBoundingClientRect().top;
  document.body.classList.add("arrastando");
  no.classList.add("arrasto-origem");
  const depois = no.getBoundingClientRect().top;
  if (depois !== antes) window.scrollBy(0, depois - antes);

  const r = no.getBoundingClientRect();
  const fantasma = no.cloneNode(true);
  fantasma.classList.remove("arrasto-origem");
  fantasma.classList.add("arrasto-fantasma");
  Object.assign(fantasma.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
  document.body.appendChild(fantasma);

  const indicador = el("div", { class: "arrasto-indicador hidden", "aria-hidden": "true" });
  document.body.appendChild(indicador);

  const a = {
    raiz, no, fantasma, indicador,
    dx: x - r.left, dy: y - r.top, x, y,
    alvo: null, rolagem: 0, raf: 0,
  };
  a.raf = requestAnimationFrame(() => passoRolagem(a));
  mover(a, x, y);
  return a;
}

function mover(a, x, y) {
  a.x = x; a.y = y;
  a.fantasma.style.left = `${x - a.dx}px`;
  a.fantasma.style.top = `${y - a.dy}px`;
  const alto = window.innerHeight;
  a.rolagem = y < BORDA_ROLAGEM ? -(BORDA_ROLAGEM - y) / 4 : y > alto - BORDA_ROLAGEM ? (y - (alto - BORDA_ROLAGEM)) / 4 : 0;
  atualizarAlvo(a);
}

function passoRolagem(a) {
  if (a.rolagem) {
    window.scrollBy(0, a.rolagem);
    atualizarAlvo(a);
  }
  a.raf = requestAnimationFrame(() => passoRolagem(a));
}

/** Vaga sob o dedo: a do ponto, ou a mais próxima (na vertical) do card do dia. */
function vagaEm(raiz, x, y) {
  const sob = document.elementFromPoint(x, y);
  if (!sob || !raiz.contains(sob)) return null;
  const direta = sob.closest(".slot");
  if (direta) return direta;
  const dia = sob.closest(".dia-card");
  if (!dia) return null;
  let melhor = null, dist = Infinity;
  for (const s of dia.querySelectorAll(".slot")) {
    const r = s.getBoundingClientRect();
    if (!r.height) continue;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < dist) { dist = d; melhor = s; }
  }
  return melhor;
}

function atualizarAlvo(a) {
  const vaga = vagaEm(a.raiz, a.x, a.y);
  if (a.alvo && a.alvo.vaga !== vaga) a.alvo.vaga.classList.remove("slot--alvo");
  if (!vaga) {
    a.alvo = null;
    a.indicador.classList.add("hidden");
    return;
  }
  vaga.classList.add("slot--alvo");
  const vizinhas = [...vaga.querySelectorAll(".agenda-linha")].filter((n) => n !== a.no);
  let indice = vizinhas.length;
  for (let i = 0; i < vizinhas.length; i++) {
    const r = vizinhas[i].getBoundingClientRect();
    if (a.y < r.top + r.height / 2) { indice = i; break; }
  }
  a.alvo = { vaga, vizinhas, indice };

  // linha de inserção (fixa na tela: não empurra o layout)
  if (!vizinhas.length) { a.indicador.classList.add("hidden"); return; }
  const rv = vaga.getBoundingClientRect();
  const topo = indice < vizinhas.length
    ? vizinhas[indice].getBoundingClientRect().top - 5
    : vizinhas[vizinhas.length - 1].getBoundingClientRect().bottom + 3;
  Object.assign(a.indicador.style, { left: `${rv.left}px`, width: `${rv.width}px`, top: `${topo}px` });
  a.indicador.classList.remove("hidden");
}

function terminar(a, soltou, contexto, aoSoltar) {
  cancelAnimationFrame(a.raf);
  a.fantasma.remove();
  a.indicador.remove();
  document.body.classList.remove("arrastando");
  a.no.classList.remove("arrasto-origem");
  if (a.alvo) a.alvo.vaga.classList.remove("slot--alvo");
  if (!soltou || !a.alvo) return;

  const { vaga, vizinhas, indice } = a.alvo;
  const { data, periodo } = vaga.dataset;
  // soltou no mesmo lugar: nada a fazer
  if (vaga.contains(a.no)) {
    const antes = [...vaga.querySelectorAll(".agenda-linha")].indexOf(a.no);
    if (antes === indice) return;
  }
  aoSoltar({ contexto, data, periodo, indice, vizinhas });
}
