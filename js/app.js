// app.js — ponto de entrada. Registra o service worker (com atualização
// controlada), decide entre onboarding e app, e inicia o router.

import * as repo from "./data/repository.js";
import { iniciarRouter } from "./views/router.js";
import { renderOnboarding } from "./views/onboarding.js";
import { carregarEAplicarTema } from "./services/theme.js";
import { sincronizarSePossivel } from "./services/sync.js";
import { el, limpar, botao } from "./views/components/ui.js";

// ---------------------------------------------------------------------------
// Service worker + banner de atualização controlada
// ---------------------------------------------------------------------------
function mostrarBannerAtualizacao(worker) {
  if (document.getElementById("update-banner")) return;
  const banner = el("div", { class: "update-banner", id: "update-banner", role: "alert" }, [
    el("span", { text: "Nova versão disponível." }),
    botao("Atualizar", {
      onClick: () => {
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    }),
  ]);
  document.body.appendChild(banner);
}

async function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const tinhaController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register("./service-worker.js");

    // Já há um SW esperando (aba reaberta): oferece atualizar.
    if (reg.waiting && navigator.serviceWorker.controller) mostrarBannerAtualizacao(reg.waiting);

    reg.addEventListener("updatefound", () => {
      const novo = reg.installing;
      if (!novo) return;
      novo.addEventListener("statechange", () => {
        // Instalado E já havia um controller => é atualização, não 1ª instalação.
        if (novo.state === "installed" && navigator.serviceWorker.controller) {
          mostrarBannerAtualizacao(novo);
        }
      });
    });

    // Quando o novo SW assume, recarrega uma única vez para carregar a casca nova.
    // Na PRIMEIRA instalação (não havia controller), não recarrega — evita o
    // flash de reload logo na abertura inicial.
    let recarregou = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!tinhaController || recarregou) return;
      recarregou = true;
      window.location.reload();
    });
  } catch (e) {
    // Falha ao registrar SW não impede o app de rodar (só perde o offline).
    console.warn("Service worker não registrado:", e);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function iniciar() {
  const container = document.getElementById("app");
  try {
    await carregarEAplicarTema();
    const plano = await repo.planoAtivo();
    if (!plano) {
      limpar(container);
      renderOnboarding(container, () => {
        // seed feito: entra no app (iniciarRouter define a rota padrão #/hoje)
        iniciarRouter();
      });
    } else {
      iniciarRouter();
      // sync em segundo plano (silencioso se offline/não configurado)
      sincronizarSePossivel().then((r) => { if (r) location.hash = location.hash || "#/hoje"; });
    }
  } catch (e) {
    limpar(container);
    container.appendChild(el("p", { class: "erro", text: "Erro ao iniciar o app: " + (e && e.message) }));
  }
}

registrarServiceWorker();
iniciar();
