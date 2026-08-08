// workout-form.js — registro e edição de treino.
// Modos: 'registro' (planejado), 'avulso' (fora do plano), 'edicao' (realizado).
// Pace calculado ao vivo, RPE em botões, sensação, desconforto expansível.

import * as repo from "../data/repository.js";
import { irPara, voltar } from "./router.js";
import {
  parseDistanciaParaMetros, parseTempoParaSegundos, calcularPaceSegPorKm,
  formatarPace, validarRegistro,
} from "../services/pace.js";
import { hoje as hojeISO } from "../services/dates.js";
import { REGIOES, SENSACOES, TIPOS } from "../services/dominio.js";
import {
  el, card, botao, campo, seletorBotoes, cabecalhoVoltar, toast,
} from "./components/ui.js";

function metrosParaInput(m) {
  return m == null ? "" : String(m / 1000).replace(".", ",");
}
function segParaInput(s) {
  if (s == null) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export async function renderFormulario(container, { modo, id }) {
  let planned = null;
  let completed = null;
  let desconfortosExistentes = [];

  if (modo === "registro") {
    planned = await repo.obterPlanned(id);
    if (!planned) throw new Error("Treino planejado não encontrado.");
    const jaTem = await repo.completedPorPlanned(id);
    if (jaTem) { irPara("editar/" + jaTem.id); return; } // já registrado -> edita
  } else if (modo === "edicao") {
    completed = await repo.obterCompleted(id);
    if (!completed) throw new Error("Treino realizado não encontrado.");
    desconfortosExistentes = await repo.listarDesconfortosPorTreino(id);
    if (completed.plannedWorkoutId) planned = await repo.obterPlanned(completed.plannedWorkoutId);
  }

  const titulo = modo === "edicao" ? "Editar treino" : modo === "avulso" ? "Treino avulso" : "Registrar treino";
  container.appendChild(cabecalhoVoltar(titulo, voltar));

  // Contexto do planejado
  if (planned) {
    container.appendChild(
      card([
        el("p", { class: "eyebrow", text: `Planejado · Semana ${planned.semana}` }),
        el("h2", { class: "titulo-lg", text: planned.titulo }),
        el("p", { class: "sub", text: `${planned.descricao} · ${planned.duracaoMin} min · RPE ${planned.rpeMin}–${planned.rpeMax}` }),
      ])
    );
  }

  // ---- Campos ----
  const inData = el("input", { type: "date", id: "f-data", value: completed?.data || planned?.dataPlanejada || hojeISO() });
  const inDist = el("input", { type: "text", inputmode: "decimal", id: "f-dist", placeholder: "ex.: 5,2", value: metrosParaInput(completed?.distanciaMetros) });
  const inTempo = el("input", { type: "text", inputmode: "numeric", id: "f-tempo", placeholder: "mm:ss ou h:mm:ss", value: segParaInput(completed?.duracaoSeg) });

  const paceValor = el("span", { class: "valor", text: "—" });
  const paceBox = el("div", { class: "pace-vivo" }, [paceValor, el("span", { class: "rot", text: "pace" })]);
  const avisosBox = el("div", { class: "avisos" });

  function recalc() {
    let metros = null, seg = null;
    try { metros = parseDistanciaParaMetros(inDist.value); } catch { metros = null; }
    try { seg = parseTempoParaSegundos(inTempo.value); } catch { seg = null; }
    const pace = calcularPaceSegPorKm(metros, seg);
    paceValor.textContent = formatarPace(pace);
    const avisos = validarRegistro({ distanciaMetros: metros, duracaoSeg: seg, paceSegPorKm: pace, fcMedia: numOuNull(inFcMed.value), fcMaxima: numOuNull(inFcMax.value) });
    avisosBox.replaceChildren(...avisos.map((a) => el("p", { text: a })));
  }
  inDist.addEventListener("input", recalc);
  inTempo.addEventListener("input", recalc);

  const rpe = seletorBotoes(
    Array.from({ length: 10 }, (_, i) => ({ valor: i + 1, rotulo: String(i + 1) })),
    { valorInicial: completed?.rpe ?? null, colunas: 5 }
  );

  const inFcMed = el("input", { type: "number", inputmode: "numeric", id: "f-fcmed", placeholder: "opcional", value: completed?.fcMedia ?? "" });
  const inFcMax = el("input", { type: "number", inputmode: "numeric", id: "f-fcmax", placeholder: "opcional", value: completed?.fcMaxima ?? "" });
  inFcMed.addEventListener("input", recalc);
  inFcMax.addEventListener("input", recalc);

  const sensacao = seletorBotoes(SENSACOES, { valorInicial: completed?.sensacao ?? null });

  // Treino avulso pode ter um tipo (melhora a classificação nos gráficos)
  const ehAvulso = modo === "avulso" || (modo === "edicao" && !planned);
  const tipoAvulso = ehAvulso
    ? seletorBotoes(
        Object.entries(TIPOS).filter(([k]) => k !== "avulso").map(([valor, rotulo]) => ({ valor, rotulo })),
        { valorInicial: completed?.tipoAvulso ?? null }
      )
    : null;

  const inObs = el("textarea", { id: "f-obs", rows: "3", placeholder: "Como foi, contexto, clima…" });
  if (completed?.observacoes) inObs.value = completed.observacoes;

  // ---- Desconforto ----
  const desconfortoContainer = el("div", { class: "stack" });
  const blocosDesc = [];
  function addBlocoDesconforto(pre = {}) {
    const regiao = seletorBotoes(REGIOES, { valorInicial: pre.regiao ?? null });
    const intensidade = seletorBotoes(
      Array.from({ length: 11 }, (_, i) => ({ valor: i, rotulo: String(i) })),
      { valorInicial: pre.intensidade ?? null, colunas: 6 }
    );
    const obs = el("input", { type: "text", placeholder: "Observação (opcional)" });
    if (pre.observacao) obs.value = pre.observacao;
    const bloco = el("div", { class: "desconforto stack" }, [
      el("label", { text: "Região" }), regiao.node,
      el("label", { text: "Intensidade (0–10)" }), intensidade.node,
      obs,
    ]);
    blocosDesc.push({ regiao, intensidade, obs, existenteId: pre.id || null });
    desconfortoContainer.appendChild(bloco);
  }
  for (const d of desconfortosExistentes) addBlocoDesconforto(d);

  const btnAddDesc = botao("+ Adicionar desconforto", { onClick: () => addBlocoDesconforto() });

  // ---- Salvar ----
  const erro = el("p", { class: "erro" });
  const btnSalvar = botao(modo === "edicao" ? "Salvar alterações" : "Salvar treino", {
    variante: "primary", bloco: true, grande: true,
    onClick: async () => {
      erro.textContent = "";
      let metros, seg;
      try { metros = parseDistanciaParaMetros(inDist.value); } catch (e) { erro.textContent = "Distância inválida."; return; }
      try { seg = parseTempoParaSegundos(inTempo.value); } catch (e) { erro.textContent = "Tempo inválido (use mm:ss ou h:mm:ss)."; return; }
      if (seg != null && seg <= 0) { erro.textContent = "O tempo precisa ser positivo."; return; }
      const pace = calcularPaceSegPorKm(metros, seg);
      const dados = {
        data: inData.value,
        distanciaMetros: metros,
        duracaoSeg: seg,
        paceSegPorKm: pace,
        rpe: rpe.get(),
        fcMedia: numOuNull(inFcMed.value),
        fcMaxima: numOuNull(inFcMax.value),
        sensacao: sensacao.get(),
        observacoes: inObs.value.trim() || null,
      };
      if (ehAvulso) dados.tipoAvulso = tipoAvulso.get();
      btnSalvar.disabled = true;
      try {
        let compId;
        if (modo === "edicao") {
          await repo.atualizarTreino(completed.id, dados);
          compId = completed.id;
          // desconfortos: adiciona novos (os existentes já estão salvos)
          for (const b of blocosDesc) {
            if (!b.existenteId && b.regiao.get()) {
              await repo.salvarDesconforto({ completedWorkoutId: compId, data: dados.data, regiao: b.regiao.get(), intensidade: b.intensidade.get() ?? null, observacao: b.obs.value.trim() || null });
            }
          }
        } else {
          const c = await repo.registrarTreino({ plannedWorkoutId: modo === "registro" ? planned.id : null, ...dados });
          compId = c.id;
          for (const b of blocosDesc) {
            if (b.regiao.get()) {
              await repo.salvarDesconforto({ completedWorkoutId: compId, data: dados.data, regiao: b.regiao.get(), intensidade: b.intensidade.get() ?? null, observacao: b.obs.value.trim() || null });
            }
          }
        }
        toast("Treino salvo.");
        irPara("detalhe/" + compId);
      } catch (e) {
        btnSalvar.disabled = false;
        erro.textContent = e && e.message ? e.message : "Não foi possível salvar.";
      }
    },
  });

  container.appendChild(
    card([
      campo("Data", inData),
      ehAvulso ? campo("Tipo de treino", tipoAvulso.node) : null,
      campo("Distância (km)", inDist, "Opcional. Aceita vírgula ou ponto."),
      campo("Tempo", inTempo, "mm:ss ou h:mm:ss."),
      paceBox,
      campo("Esforço percebido (RPE 1–10)", rpe.node),
      el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } }, [
        campo("FC média", inFcMed), campo("FC máxima", inFcMax),
      ]),
      campo("Sensação geral", sensacao.node),
      campo("Observações", inObs),
    ])
  );

  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Desconforto (opcional)" }),
      desconfortoContainer,
      btnAddDesc,
    ])
  );

  avisosBox && container.appendChild(avisosBox);
  container.appendChild(erro);
  container.appendChild(btnSalvar);
  recalc();
}

function numOuNull(v) {
  const t = String(v).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
