// router.js — navegação por hash com suporte a parâmetros.
//   #/hoje                 -> aba
//   #/registrar/<planId>   -> formulário (registro de um treino planejado)
//   #/avulso               -> formulário (treino fora do plano)
//   #/editar/<compId>      -> formulário (edição de treino realizado)
//   #/detalhe/<compId>     -> planejado × realizado
//   #/ajuda                -> tela de ajuda
//
// Renderização atômica por token (evita render duplicado em gatilhos próximos).

import { renderHoje } from "./today.js";
import { renderCalendario } from "./calendar.js";
import { renderEvolucao } from "./evolution.js";
import { renderHistorico } from "./history.js";
import { renderAjustes } from "./settings.js";
import { renderAjuda } from "./help.js";
import { renderFormulario } from "./workout-form.js";
import { renderDetalhe } from "./workout-detail.js";
import { el, limpar } from "./components/ui.js";

const ABAS = { hoje: renderHoje, calendario: renderCalendario, evolucao: renderEvolucao, historico: renderHistorico, ajustes: renderAjustes };
const CHEIAS = {
  registrar: (c, p) => renderFormulario(c, { modo: "registro", id: p }),
  avulso: (c) => renderFormulario(c, { modo: "avulso" }),
  editar: (c, p) => renderFormulario(c, { modo: "edicao", id: p }),
  detalhe: (c, p) => renderDetalhe(c, { id: p }),
  ajuda: (c) => renderAjuda(c),
};

let token = 0;

function parseHash() {
  const bruto = (location.hash || "#/hoje").replace(/^#\//, "");
  const partes = bruto.split("/");
  return { rota: partes[0] || "hoje", param: partes[1] ? decodeURIComponent(partes[1]) : null };
}

function marcarAba(rota) {
  document.querySelectorAll(".tabbar a").forEach((a) => {
    if (a.dataset.rota === rota) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

async function montar() {
  const { rota, param } = parseHash();
  const meu = ++token;
  const ehAba = !!ABAS[rota];
  marcarAba(ehAba ? rota : "");

  // fecha qualquer bottom sheet aberto ao trocar de tela
  const sheet = document.querySelector(".sheet-overlay");
  if (sheet) sheet.remove();

  const render = ABAS[rota] || CHEIAS[rota] || ABAS.hoje;
  const temp = document.createElement("div");
  try {
    await render(temp, param);
  } catch (e) {
    limpar(temp);
    temp.appendChild(el("p", { class: "erro", text: "Erro ao carregar a tela: " + (e && e.message) }));
  }
  if (meu !== token) return;

  const container = document.getElementById("app");
  limpar(container);
  while (temp.firstChild) container.appendChild(temp.firstChild);
  container.scrollTop = 0;
  window.scrollTo(0, 0);
}

export function iniciarRouter() {
  window.addEventListener("hashchange", montar);
  if (!location.hash) location.hash = "#/hoje";
  else montar();
}

export function irPara(rota) {
  location.hash = "#/" + rota;
}

export function voltar() {
  if (history.length > 1) history.back();
  else irPara("hoje");
}
