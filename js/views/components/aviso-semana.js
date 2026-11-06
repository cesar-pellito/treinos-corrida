// aviso-semana.js — "Sua semana mudou. Quer reorganizar?", no topo de Hoje e de Treinos, e o
// alerta depois de mover um treino à mão.

import { desfazerMudanca, manterMudanca, moverComAlerta, situacaoSemana } from "../../services/semana.js";
import { irPara, recarregar } from "../router.js";
import { el, botao, abrirSheet, toast } from "./ui.js";

/** Devolve o aviso, ou null com a semana em dia. Uma falha aqui não derruba a tela. */
export async function avisoSemana() {
  try {
    const { aviso } = await situacaoSemana();
    if (!aviso) return null;
    return el("button", { type: "button", class: "aviso-semana", text: "Sua semana mudou. Quer reorganizar? ›", onClick: () => irPara("semana") });
  } catch (e) {
    console.warn("Aviso da semana indisponível:", e);
    return null;
  }
}

function sheetAlerta(alerta) {
  const decidir = (acao, mensagem) => async () => {
    fechar();
    try { await acao(alerta); toast(mensagem); }
    catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
    await recarregar();
  };
  const fechar = abrirSheet("Talvez essa não seja a melhor combinação", el("div", { class: "stack" }, [
    el("ul", {}, alerta.motivos.map((m) => el("li", { text: m }))),
    el("div", { class: "lista-acoes" }, [
      botao("Manter minha escolha", { variante: "primary", bloco: true, onClick: decidir(manterMudanca, "Escolha mantida.") }),
      botao("Desfazer", { variante: "ghost", bloco: true, onClick: decidir(desfazerMudanca, "Treino de volta ao lugar.") }),
    ]),
  ]));
}

/** Move um treino à mão: o treino vai para o destino e, se a semana piorou, o alerta abre. */
export async function moverComAviso(entrada, dataAtual, destino, mensagem) {
  let alerta = null;
  try {
    alerta = await moverComAlerta(entrada, dataAtual, destino);
    if (!alerta) toast(mensagem);
  } catch (e) {
    toast("Não foi possível mover: " + (e && e.message));
  }
  await recarregar();
  if (alerta) sheetAlerta(alerta);
}
