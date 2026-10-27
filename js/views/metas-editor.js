// metas-editor.js — Ajustes → Metas. Tudo que o app compara vem daqui.

import { obterMetas, salvarMetas } from "../services/metas.js";
import { voltar } from "./router.js";
import { el, card, botao, cabecalhoVoltar, toast, campo } from "./components/ui.js";

function inputNum(id, valor) {
  return el("input", { type: "number", id, value: valor, inputmode: "numeric", step: "1", min: "0" });
}
const ler = (input) => (input.value === "" ? NaN : Number(String(input.value).replace(",", ".")));

export async function renderEditorMetas(container) {
  container.appendChild(cabecalhoVoltar("Metas", voltar));
  const m = await obterMetas();

  const pMin = inputNum("m-pmin", m.proteinaMinG);
  const pMax = inputNum("m-pmax", m.proteinaMaxG);
  const lower = inputNum("m-lower", m.lowerPorSemana);
  const erro = el("p", { class: "erro" });

  const par = (a, b) => el("div", { class: "par-campos" }, [a, b]);

  container.appendChild(el("p", { class: "sub", text: "O app só mostra seus números contra estas metas. Nada aqui é recomendação." }));

  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Proteína por dia (g)" }),
    par(campo("Mínimo", pMin), campo("Máximo", pMax)),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Perna" }),
    campo("Treinos de Lower por semana", lower),
  ]));

  const salvar = botao("Salvar metas", {
    variante: "primary", bloco: true, onClick: async () => {
      erro.textContent = "";
      try {
        await salvarMetas({
          proteinaMinG: ler(pMin), proteinaMaxG: ler(pMax), lowerPorSemana: ler(lower),
        });
        toast("Metas salvas.");
      } catch (e) {
        erro.textContent = e.message;
      }
    },
  });
  container.appendChild(erro);
  container.appendChild(salvar);
}
