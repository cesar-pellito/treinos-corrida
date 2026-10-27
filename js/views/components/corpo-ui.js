// corpo-ui.js — card de peso (Hoje) e folhas de pesagem e InBody.

import { recarregar, irPara } from "../router.js";
import { salvarPesagem, salvarInBody, removerMedida } from "../../services/corpo.js";
import { hoje as hojeISO, deISODate } from "../../services/dates.js";
import { el, botao, abrirSheet, toast, campo, stepper, lerNumero } from "./ui.js";

export const fmtKg = (n, casas = 1) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const ddmm = (iso) => {
  const d = deISODate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** "perda de 0,42 kg/sem" | "ganho de 0,10 kg/sem" | "estável". */
export function textoRitmo(kgSemana) {
  if (kgSemana == null) return "—";
  if (Math.abs(kgSemana) < 0.005) return "estável";
  return `${kgSemana > 0 ? "perda" : "ganho"} de ${fmtKg(Math.abs(kgSemana), 2)} kg/sem`;
}

async function agir(fn) {
  try { await fn(); }
  catch (e) { toast("Não foi possível salvar: " + (e && e.message)); }
  await recarregar();
}

// ---------------------------------------------------------------------------
// Card do Hoje
// ---------------------------------------------------------------------------
export function cardPeso(c) {
  const { ultima, media7, ritmo, situacao, metas, faltamKg } = c;
  return el("section", { class: "card" }, [
    el("div", { class: "row-between" }, [
      el("p", { class: "eyebrow", text: "Peso" }),
      el("button", { type: "button", class: "link-sutil", text: "Ver corpo", onClick: () => irPara("corpo") }),
    ]),
    ultima
      ? el("div", { class: "peso-resumo" }, [
          el("div", {}, [
            el("span", { class: "rotulo", text: `Última · ${ddmm(ultima.data)}` }),
            el("span", { class: "strong grande", text: `${fmtKg(ultima.pesoKg)} kg` }),
          ]),
          el("div", {}, [
            el("span", { class: "rotulo", text: "Média 7 dias" }),
            el("span", { class: "strong grande", text: media7 == null ? "—" : `${fmtKg(media7)} kg` }),
          ]),
          el("div", {}, [
            el("span", { class: "rotulo", text: "Ritmo" }),
            el("span", { class: "strong", text: ritmo ? textoRitmo(ritmo.kgSemana) : "—" }),
          ]),
        ])
      : el("p", { class: "sub", text: "Nenhuma pesagem ainda." }),
    el("p", { class: "sub pequeno", text: [
      `faixa ${fmtKg(metas.ritmoMinKgSem)}–${fmtKg(metas.ritmoMaxKgSem)} kg/sem${situacao ? " · " + situacao : ""}`,
      faltamKg != null ? `${fmtKg(Math.max(0, faltamKg))} kg até ${fmtKg(metas.pesoAlvoKg)} kg` : null,
      !ritmo && ultima ? "ritmo aparece com pesagens em 2 semanas" : null,
    ].filter(Boolean).join(" · ") }),
    el("div", { class: "agenda-acoes" }, [
      botao("+ Pesagem", { variante: "ghost", onClick: () => sheetPesagem({ ultimoPeso: ultima && ultima.pesoKg }) }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Folhas
// ---------------------------------------------------------------------------
function inputKg(id, valor, placeholder) {
  return el("input", { type: "number", id, inputmode: "decimal", step: "0.1", min: "0", value: valor ?? "", placeholder: placeholder || "" });
}

/** Pesagem da balança (Fitdays). `medida` = editar uma existente. */
export function sheetPesagem({ medida = null, ultimoPeso = null } = {}) {
  const inData = el("input", { type: "date", id: "pe-data", value: medida ? medida.data : hojeISO() });
  const inPeso = inputKg("pe-peso", medida ? medida.pesoKg.toFixed(1) : (ultimoPeso != null ? ultimoPeso.toFixed(1) : ""), "ex.: 85.4");
  const inGord = inputKg("pe-gord", medida && medida.gorduraPct, "opcional");
  const inMusc = inputKg("pe-musc", medida && medida.massaMuscularKg, "opcional");
  const inVisc = inputKg("pe-visc", medida && medida.gorduraVisceral, "opcional");
  const mais = el("details", { class: "mais-campos" }, [
    el("summary", { text: "Massa muscular e gordura visceral" }),
    campo("Massa muscular (kg)", inMusc),
    campo("Gordura visceral", inVisc),
  ]);
  if (medida && (medida.massaMuscularKg != null || medida.gorduraVisceral != null)) mais.open = true;
  const erro = el("p", { class: "erro" });

  const salvar = botao("Salvar pesagem", {
    variante: "primary", bloco: true, onClick: async () => {
      const peso = lerNumero(inPeso);
      const opc = [lerNumero(inGord), lerNumero(inMusc), lerNumero(inVisc)];
      if (!(peso > 20)) { erro.textContent = "Informe o peso em kg."; return; }
      if (opc.some((v) => Number.isNaN(v))) { erro.textContent = "Algum campo opcional não é um número."; return; }
      if (!inData.value) { erro.textContent = "Escolha a data."; return; }
      salvar.disabled = true;
      fechar();
      await agir(() => salvarPesagem({
        id: medida && medida.id, criadoEm: medida && medida.criadoEm, data: inData.value,
        pesoKg: peso, gorduraPct: opc[0], massaMuscularKg: opc[1], gorduraVisceral: opc[2],
      }));
    },
  });
  const remover = medida
    ? botao("Remover pesagem", { variante: "perigo", bloco: true, onClick: async () => { fechar(); await agir(() => removerMedida(medida)); } })
    : null;

  const fechar = abrirSheet(medida ? "Editar pesagem" : "Pesagem", el("div", { class: "stack" }, [
    el("div", { class: "campo" }, [el("label", { for: "pe-peso", text: "Peso (kg)" }), stepper(inPeso)]),
    campo("% de gordura", inGord),
    mais,
    campo("Data", inData),
    erro,
    el("div", { class: "lista-acoes" }, [salvar, remover]),
  ]));
}

/** Avaliação InBody (referência). */
export function sheetInBody({ medida = null } = {}) {
  const inData = el("input", { type: "date", id: "ib-data", value: medida ? medida.data : hojeISO() });
  const campos = [
    ["pesoKg", "Peso (kg)"], ["massaGorduraKg", "Massa de gordura (kg)"], ["massaLivreGorduraKg", "Massa livre de gordura (kg)"],
    ["massaMuscularEsqueleticaKg", "Massa muscular esquelética (kg)"], ["gorduraPct", "% de gordura"],
  ].map(([k, rot]) => ({ k, rot, input: inputKg(`ib-${k}`, medida && medida[k]) }));
  const erro = el("p", { class: "erro" });

  const salvar = botao("Salvar InBody", {
    variante: "primary", bloco: true, onClick: async () => {
      const v = Object.fromEntries(campos.map((c) => [c.k, lerNumero(c.input)]));
      if (campos.some((c) => v[c.k] == null || Number.isNaN(v[c.k]))) { erro.textContent = "Preencha todos os campos com números."; return; }
      if (!inData.value) { erro.textContent = "Escolha a data."; return; }
      salvar.disabled = true;
      fechar();
      await agir(() => salvarInBody({ id: medida && medida.id, criadoEm: medida && medida.criadoEm, data: inData.value, ...v }));
    },
  });
  const remover = medida
    ? botao("Remover InBody", { variante: "perigo", bloco: true, onClick: async () => { fechar(); await agir(() => removerMedida(medida)); } })
    : null;

  const fechar = abrirSheet(medida ? "Editar InBody" : "InBody", el("div", { class: "stack" }, [
    campo("Data", inData),
    ...campos.map((c) => campo(c.rot, c.input)),
    erro,
    el("div", { class: "lista-acoes" }, [salvar, remover]),
  ]));
}
