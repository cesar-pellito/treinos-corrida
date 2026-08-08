// settings.js — Ajustes completos: preferências, exportar .ics, backup JSON,
// importar, sincronização com Google Sheets, tema e ajuda.

import * as repo from "../data/repository.js";
import { irPara } from "./router.js";
import { nomeDiaSemana, deISODate, hoje as hojeISO } from "../services/dates.js";
import { gerarICS } from "../services/ics.js";
import { exportarBackup, importarBackupTexto, entregarArquivo, estadoBackup } from "../services/backup.js";
import * as sync from "../services/sync.js";
import { aplicarTema } from "../services/theme.js";
import { calcularZonasFC } from "../services/dominio.js";
import { el, card, botao, campo, tituloVista, seletorBotoes, toast, estadoVazio } from "./components/ui.js";

const NOMES_DIA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function linha(rotulo, valor) {
  return el("div", { class: "linha", style: { borderBottom: "1px solid var(--border)" } }, [
    el("span", { class: "muted", text: rotulo }),
    el("span", { class: "strong", text: valor }),
  ]);
}

export async function renderAjustes(container) {
  container.appendChild(tituloVista("Ajustes"));
  const plan = await repo.planoAtivo();
  if (!plan) { container.appendChild(estadoVazio("Sem plano ativo", "Reabra o app para configurar.")); return; }
  const cfg = await repo.obterConfigs();
  const backupSt = await estadoBackup();

  // ---- Plano ----
  const inicio = deISODate(plan.dataInicio);
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Plano" }),
      el("h2", { class: "titulo-lg", text: plan.nome }),
      linha("Início (semana 1)", `${String(inicio.getDate()).padStart(2, "0")}/${String(inicio.getMonth() + 1).padStart(2, "0")}/${inicio.getFullYear()} (${nomeDiaSemana(plan.dataInicio)})`),
      linha("Dias de treino", (plan.diasTreino || []).map((d) => NOMES_DIA[d]).join(", ") || "—"),
      linha("Total de semanas", String(plan.totalSemanas)),
    ])
  );

  // ---- Preferências ----
  const inLembrete = el("input", { type: "time", id: "s-lembrete", value: cfg.horarioLembrete || "20:00" });
  const inTreino = el("input", { type: "time", id: "s-treino", value: cfg.horarioTreino || "06:30" });
  const inFcMax = el("input", { type: "number", id: "s-fcmax", inputmode: "numeric", placeholder: "ex.: 190", value: cfg.fcMaxima ?? 190 });
  const tema = seletorBotoes(
    [{ valor: "auto", rotulo: "Automático" }, { valor: "claro", rotulo: "Claro" }, { valor: "escuro", rotulo: "Escuro" }],
    { valorInicial: cfg.temaEscuro || "auto", onChange: (v) => { aplicarTema(v); repo.definirConfig("temaEscuro", v); } }
  );
  const btnSalvarPrefs = botao("Salvar preferências", {
    variante: "primary", bloco: true, onClick: async () => {
      await repo.definirConfig("horarioLembrete", inLembrete.value || "20:00");
      await repo.definirConfig("horarioTreino", inTreino.value || "06:30");
      await repo.definirConfig("fcMaxima", inFcMax.value ? Number(inFcMax.value) : null);
      toast("Preferências salvas.");
    },
  });
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Preferências" }),
      campo("Horário do lembrete (dia anterior)", inLembrete),
      campo("Horário do treino (no calendário)", inTreino),
      campo("FC máxima (opcional)", inFcMax, "Usada como referência de zonas. O plano prioriza RPE."),
      campo("Tema", tema.node),
      btnSalvarPrefs,
    ])
  );

  // ---- Zonas de FC (calculadas da FC máxima, ao vivo) ----
  const zonasBox = el("div", {});
  function renderZonas() {
    const fcMax = Number(inFcMax.value) || 190;
    zonasBox.replaceChildren(
      el("p", { class: "eyebrow", text: `Zonas de FC · FC máx ${fcMax}` }),
      el("p", { class: "sub", text: "O plano prioriza RPE; use a FC como conferência. O grosso do plano é a zona Fácil." }),
      ...calcularZonasFC(fcMax).map((z) =>
        el("div", { class: "linha", style: { borderBottom: "1px solid var(--border)" } }, [
          el("span", {}, [el("span", { class: "strong", text: z.nome }), document.createTextNode(` · RPE ${z.rpe}`)]),
          el("span", { class: "muted", text: z.aberta ? `${z.bpmMin}+ bpm` : `${z.bpmMin}–${z.bpmMax} bpm` }),
        ])
      )
    );
  }
  inFcMax.addEventListener("input", renderZonas);
  renderZonas();
  container.appendChild(card([zonasBox]));

  // ---- Calendário .ics ----
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Lembretes no calendário" }),
      el("p", { class: "sub", text: "Exporte os treinos futuros como arquivo .ics e importe no Google Agenda uma vez." }),
      el("div", { class: "lista-acoes" }, [
        botao("Exportar calendário (.ics)", {
          variante: "primary", bloco: true, onClick: async () => {
            const todos = await repo.listarPlanned({ planId: plan.id });
            const futuros = todos.filter((w) => w.dataPlanejada >= hojeISO() && w.status !== "concluido" && w.status !== "nao_realizado");
            if (!futuros.length) { toast("Nenhum treino futuro para exportar."); return; }
            const ics = gerarICS(futuros, { horarioTreino: cfg.horarioTreino || "06:30", horarioLembrete: cfg.horarioLembrete || "20:00" });
            const metodo = await entregarArquivo(`plano-corrida-${hojeISO()}.ics`, ics, "text/calendar");
            if (metodo === "download" || metodo === "share") toast("Calendário exportado.");
          },
        }),
        botao("Como funcionam os lembretes", { bloco: true, onClick: () => irPara("ajuda") }),
      ]),
    ])
  );

  // ---- Backup ----
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Backup" }),
      el("p", {
        class: backupSt.vencido ? "aviso" : "sub",
        style: backupSt.vencido ? { background: "var(--warn-weak)", color: "var(--warn)", padding: "10px 12px", borderRadius: "10px" } : {},
        text: backupSt.nunca ? "Você ainda não fez backup. Faça um agora." : `Último backup há ${backupSt.dias} ${backupSt.dias === 1 ? "dia" : "dias"}.${backupSt.vencido ? " Faça um novo." : ""}`,
      }),
      el("div", { class: "lista-acoes" }, [
        botao("Exportar backup (JSON)", {
          variante: "primary", bloco: true, onClick: async () => {
            try { const r = await exportarBackup(); if (r.metodo !== "cancelado") toast("Backup exportado."); }
            catch (e) { toast("Falha no backup: " + e.message); }
          },
        }),
        botaoImportar(),
      ]),
    ])
  );

  // ---- Sincronização com Google Sheets ----
  const inUrl = el("input", { type: "text", id: "s-url", placeholder: "URL do app da Web (Apps Script)", value: cfg.syncUrl || "" });
  const inToken = el("input", { type: "text", id: "s-token", placeholder: "Token", value: cfg.syncToken || "" });
  const statusSync = el("p", { class: "sub", text: cfg.ultimoSync ? `Última sincronização: ${cfg.ultimoSync.slice(0, 16).replace("T", " ")}` : "Nunca sincronizado." });
  container.appendChild(
    card([
      el("p", { class: "eyebrow", text: "Sincronização (Google Sheets)" }),
      el("p", { class: "sub", text: "Opcional. Mantém uma cópia na nuvem e sincroniza entre dispositivos. O app continua 100% offline; isto roda em segundo plano." }),
      campo("URL do endpoint", inUrl),
      campo("Token", inToken),
      statusSync,
      el("div", { class: "lista-acoes" }, [
        botao("Salvar e testar conexão", {
          bloco: true, onClick: async () => {
            await repo.definirConfig("syncUrl", inUrl.value.trim() || null);
            await repo.definirConfig("syncToken", inToken.value.trim() || "");
            try { await sync.testarConexao(); toast("Conexão OK."); }
            catch (e) { toast("Falha: " + e.message); }
          },
        }),
        botao("Sincronizar agora", {
          variante: "primary", bloco: true, onClick: async () => {
            try {
              const r = await sync.sincronizar();
              statusSync.textContent = `Enviados ${r.enviados}; recebidos ${r.pull.criados + r.pull.atualizados}.`;
              toast("Sincronizado.");
            } catch (e) { toast("Falha: " + e.message); }
          },
        }),
      ]),
    ])
  );

  container.appendChild(botao("Ajuda", { bloco: true, onClick: () => irPara("ajuda") }));
}

function botaoImportar() {
  const input = el("input", { type: "file", accept: "application/json,.json", style: { display: "none" } });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const texto = await file.text();
      const rel = await importarBackupTexto(texto);
      toast(`Importado: ${rel.criados} criados, ${rel.atualizados} atualizados, ${rel.ignorados} ignorados.`);
      irPara("hoje");
    } catch (e) { toast("Falha ao importar: " + e.message); }
    input.value = "";
  });
  const b = botao("Importar backup (JSON)", { bloco: true, onClick: () => input.click() });
  const wrap = el("div", {}, [b, input]);
  return wrap;
}
