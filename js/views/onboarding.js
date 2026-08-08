// onboarding.js — primeira execução. Coleta data de início e dias de treino,
// semeia o plano e entrega o controle ao app.

import * as seed from "../data/seed.js";
import { hoje, diaDaSemana, somarDias } from "../services/dates.js";
import { el, card, botao, tituloVista } from "./components/ui.js";

// Ordem de exibição: segunda a domingo. value = getDay() (0=dom).
const DIAS = [
  { v: 1, r: "Seg" }, { v: 2, r: "Ter" }, { v: 3, r: "Qua" }, { v: 4, r: "Qui" },
  { v: 5, r: "Sex" }, { v: 6, r: "Sáb" }, { v: 0, r: "Dom" },
];

function proximaSegunda() {
  const h = hoje();
  const offset = (1 - diaDaSemana(h) + 7) % 7; // 0 se já for segunda
  return somarDias(h, offset);
}

export async function renderOnboarding(container, onDone) {
  container.appendChild(tituloVista("Configurar plano"));

  const selecionados = new Set([1, 3, 5]); // seg/qua/sex por padrão

  const inputData = el("input", { type: "date", id: "dataInicio", value: proximaSegunda() });

  const avisoEspaco = el("p", { class: "avisos" });

  function saoConsecutivos(dias) {
    const set = new Set(dias);
    for (const d of dias) if (set.has((d + 1) % 7)) return true; // dia seguinte também marcado
    return false;
  }
  function verificarEspaco() {
    const dias = [...selecionados];
    if (dias.length >= 2 && saoConsecutivos(dias)) {
      avisoEspaco.textContent = "Atenção: há dias de treino consecutivos. Nas fases 1 e 2 o plano evita correr em dias seguidos (você pode seguir assim mesmo).";
    } else {
      avisoEspaco.textContent = "";
    }
  }

  const chips = DIAS.map((d) =>
    el("button", {
      class: "chip", type: "button", text: d.r, "aria-pressed": selecionados.has(d.v),
      onClick: (ev) => {
        if (selecionados.has(d.v)) selecionados.delete(d.v);
        else selecionados.add(d.v);
        ev.currentTarget.setAttribute("aria-pressed", selecionados.has(d.v));
        erro.textContent = "";
        verificarEspaco();
      },
    })
  );

  const erro = el("p", { class: "erro" });

  const botaoCriar = botao("Criar meu plano", {
    variante: "primary", bloco: true, grande: true,
    onClick: async () => {
      erro.textContent = "";
      const dias = [...selecionados];
      if (dias.length < 2 || dias.length > 3) {
        erro.textContent = "Escolha 2 ou 3 dias de treino por semana.";
        return;
      }
      if (!inputData.value) {
        erro.textContent = "Escolha a data de início.";
        return;
      }
      botaoCriar.disabled = true;
      botaoCriar.textContent = "Criando…";
      try {
        await seed.executarSeedSeNecessario({
          dataInicio: inputData.value,
          diasTreino: dias,
          primeiroDiaSemana: 1,
        });
        onDone();
      } catch (e) {
        botaoCriar.disabled = false;
        botaoCriar.textContent = "Criar meu plano";
        erro.textContent = "Não foi possível criar o plano: " + (e && e.message);
      }
    },
  });

  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Plano de Retorno à Corrida — 22 semanas" }),
      el("p", { class: "sub", text: "São 3 sessões por semana. Escolha quando começar e em quais dias você treina. As datas dos 66 treinos são calculadas a partir disso." }),

      el("div", { class: "campo", style: { marginTop: "16px" } }, [
        el("label", { for: "dataInicio", text: "Início da semana 1" }),
        inputData,
        el("p", { class: "ajuda", text: "A semana do plano começa na segunda-feira dessa data." }),
      ]),

      el("div", { class: "campo" }, [
        el("label", { text: "Dias de treino (2 ou 3)" }),
        el("div", { class: "chips" }, chips),
        el("p", { class: "ajuda", text: "Com 2 dias, o app corta a sessão do meio (e mantém a longa e a de qualidade nas fases finais)." }),
        avisoEspaco,
      ]),

      erro,
      botaoCriar,
    ])
  );
}
