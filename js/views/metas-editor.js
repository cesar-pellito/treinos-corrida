// metas-editor.js — Ajustes → Metas. Tudo que o app compara vem daqui.

import { obterMetas, salvarMetas } from "../services/metas.js";
import { voltar } from "./router.js";
import { el, card, botao, cabecalhoVoltar, toast, campo } from "./components/ui.js";

function inputNum(id, valor, { decimal } = {}) {
  return el("input", {
    type: "number", id, value: valor, inputmode: decimal ? "decimal" : "numeric",
    step: decimal ? "0.1" : "1", min: "0",
  });
}
const ler = (input) => (input.value === "" ? NaN : Number(String(input.value).replace(",", ".")));

export async function renderEditorMetas(container) {
  container.appendChild(cabecalhoVoltar("Metas", voltar));
  const m = await obterMetas();

  const pMin = inputNum("m-pmin", m.proteinaMinG);
  const pMax = inputNum("m-pmax", m.proteinaMaxG);
  const rMin = inputNum("m-rmin", m.ritmoMinKgSem, { decimal: true });
  const rMax = inputNum("m-rmax", m.ritmoMaxKgSem, { decimal: true });
  const alvo = inputNum("m-alvo", m.pesoAlvoKg, { decimal: true });
  const lower = inputNum("m-lower", m.lowerPorSemana);
  const sQuad = inputNum("m-quad", m.seriesPerna.quadriceps);
  const sPost = inputNum("m-post", m.seriesPerna.posteriorGluteo);
  const sPant = inputNum("m-pant", m.seriesPerna.panturrilha);
  const erro = el("p", { class: "erro" });

  const par = (a, b) => el("div", { class: "par-campos" }, [a, b]);

  container.appendChild(el("p", { class: "sub", text: "O app só mostra seus números contra estas metas. Nada aqui é recomendação." }));

  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Proteína por dia (g)" }),
    par(campo("Mínimo", pMin), campo("Máximo", pMax)),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Peso" }),
    par(campo("Perda mín. (kg/sem)", rMin), campo("Perda máx. (kg/sem)", rMax)),
    campo("Peso-alvo (kg)", alvo),
  ]));
  container.appendChild(card([
    el("p", { class: "eyebrow", text: "Perna" }),
    campo("Treinos de Lower por semana", lower),
    el("p", { class: "sub", text: "Séries semanais de trabalho (sem aquecimento), contadas na importação do Gravl:" }),
    par(campo("Quadríceps", sQuad), campo("Posterior e glúteo", sPost)),
    campo("Panturrilha", sPant),
  ]));

  const salvar = botao("Salvar metas", {
    variante: "primary", bloco: true, onClick: async () => {
      erro.textContent = "";
      try {
        await salvarMetas({
          proteinaMinG: ler(pMin), proteinaMaxG: ler(pMax),
          ritmoMinKgSem: ler(rMin), ritmoMaxKgSem: ler(rMax),
          pesoAlvoKg: ler(alvo), lowerPorSemana: ler(lower),
          seriesPerna: { quadriceps: ler(sQuad), posteriorGluteo: ler(sPost), panturrilha: ler(sPant) },
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
