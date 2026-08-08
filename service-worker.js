// service-worker.js — casca offline com cache versionado.
//
// Estratégia:
//   - cache-first para a casca (HTML/CSS/JS/ícones/seed): o que está no cache
//     responde na hora; a rede só serve para popular o cache na 1ª vez.
//   - NÃO há fallback de rede para dados: os dados vivem no IndexedDB, o SW nem
//     os intercepta.
//   - Atualização controlada: o app pergunta antes de recarregar (SKIP_WAITING),
//     nunca troca sozinho no meio de um registro.
//
// Ao mudar qualquer arquivo da casca, incremente CACHE_VERSAO.

const CACHE_VERSAO = "v5";
const CACHE_NOME = `treinos-corrida-${CACHE_VERSAO}`;

const CASCA = [
  "./",
  "./index.html",
  "./styles/app.css",
  "./manifest.webmanifest",
  "./data/plano-seed.json",
  "./js/app.js",
  "./js/views/router.js",
  "./js/views/onboarding.js",
  "./js/views/today.js",
  "./js/views/calendar.js",
  "./js/views/evolution.js",
  "./js/views/history.js",
  "./js/views/settings.js",
  "./js/views/help.js",
  "./js/views/workout-form.js",
  "./js/views/workout-detail.js",
  "./js/views/components/ui.js",
  "./js/views/components/charts.js",
  "./js/services/schedule.js",
  "./js/services/dates.js",
  "./js/services/pace.js",
  "./js/services/stats.js",
  "./js/services/discomfort.js",
  "./js/services/dominio.js",
  "./js/services/ics.js",
  "./js/services/backup.js",
  "./js/services/sync.js",
  "./js/services/theme.js",
  "./js/data/db.js",
  "./js/data/repository.js",
  "./js/data/seed.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/icons/apple-touch-icon-180.png",
  "./assets/icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NOME).then((cache) => cache.addAll(CASCA))
    // Não chamamos skipWaiting aqui: esperamos o usuário confirmar a atualização.
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes.filter((n) => n.startsWith("treinos-corrida-") && n !== CACHE_NOME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // só nossa própria origem

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NOME);
      const cacheado = await cache.match(req, { ignoreSearch: true });
      if (cacheado) return cacheado;
      try {
        const resp = await fetch(req);
        // popula o cache para próximas aberturas (inclui navegações)
        if (resp && resp.ok && resp.type === "basic") cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        // Offline e não cacheado: para navegação, cai no index (casca do SPA).
        if (req.mode === "navigate") {
          const fallback = await cache.match("./index.html");
          if (fallback) return fallback;
        }
        throw e;
      }
    })()
  );
});

// O app pede para ativar o novo SW quando o usuário clicar em "Atualizar".
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
