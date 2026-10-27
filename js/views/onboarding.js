// onboarding.js — primeira execução. Coleta data de início e dias de treino,
// semeia o plano e entrega o controle ao app.

import * as seed from "../data/seed.js";
import * as repo from "../data/repository.js";
import { importarBackupTexto } from "../services/backup.js";
import { listarAgendaOrdenada } from "../services/agenda.js";
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
  container.appendChild(tituloVista("Configurar plano de corrida"));

  // Padrão: os dias de corrida da agenda semanal (2 ou 3); senão seg/qua/sex.
  const diasCorridaAgenda = [...new Set((await listarAgendaOrdenada()).filter((i) => i.tipo === "corrida").map((i) => i.diaSemana))];
  const selecionados = new Set(diasCorridaAgenda.length >= 2 && diasCorridaAgenda.length <= 3 ? diasCorridaAgenda : [1, 3, 5]);

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

  const botaoCriar = botao("Criar plano de corrida", {
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
        botaoCriar.textContent = "Criar plano de corrida";
        erro.textContent = "Não foi possível criar o plano: " + (e && e.message);
      }
    },
  });

  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Plano de Retorno à Corrida — 22 semanas" }),
      el("p", { class: "sub", text: "O plano foi escrito para 3 sessões por semana (66 treinos). Escolha quando começar e em quais dias você corre: as datas são calculadas a partir disso." }),

      el("div", { class: "campo", style: { marginTop: "16px" } }, [
        el("label", { for: "dataInicio", text: "Início da semana 1" }),
        inputData,
        el("p", { class: "ajuda", text: "A semana do plano começa na segunda-feira dessa data." }),
      ]),

      el("div", { class: "campo" }, [
        el("label", { text: "Dias de treino (2 ou 3)" }),
        el("div", { class: "chips" }, chips),
        el("p", { class: "ajuda", text: "Com 2 dias (44 treinos), o app segue a regra do próprio plano: nas fases 1 e 2 sai a sessão B; nas fases 3 e 4 sai a A, mantendo a de qualidade e a rodagem longa. A longa fica sempre no dia mais tarde da semana." }),
        avisoEspaco,
      ]),

      erro,
      botaoCriar,
    ])
  );

  container.appendChild(cardRestaurar());
}

/**
 * App reinstalado ou aparelho novo: restaura o backup JSON direto da primeira
 * tela (Ajustes ainda não está acessível sem plano). Se o backup trouxer um
 * plano ativo, recarrega e entra no app; senão, os dados ficam e o plano é
 * criado acima.
 */
function cardRestaurar() {
  const status = el("p", { class: "sub" });
  const input = el("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
  const b = botao("Restaurar de um backup (JSON)", { bloco: true, onClick: () => input.click() });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    b.disabled = true;
    status.textContent = "Restaurando…";
    try {
      const rel = await importarBackupTexto(await file.text());
      if (await repo.planoAtivo()) {
        location.replace(location.pathname + location.search); // entra no app com os dados restaurados
        return;
      }
      status.textContent = `Backup restaurado (${rel.criados} registros), mas sem plano de corrida ativo. Crie o plano acima.`;
    } catch (e) {
      status.textContent = "Não foi possível restaurar: " + (e && e.message);
    }
    b.disabled = false;
  });
  return card([
    el("p", { class: "eyebrow", text: "Já usa o PaceUp?" }),
    el("p", { class: "sub", text: "Reinstalou o app ou trocou de aparelho? Escolha o arquivo de backup que você exportou em Ajustes. Seus treinos, agenda e refeições voltam como estavam." }),
    b,
    input,
    status,
  ]);
}
