/*
 * Service worker de FastBoard (application installée), généré à chaque construction de l'interface.
 *
 * - Pages : le réseau d'abord (jamais une interface périmée), la dernière page reçue sans réseau.
 * - Ressources versionnées (/assets/…) : gardées, elles ne changent jamais sous un même nom.
 * - Écrans chargés à la demande (/assets/…) : gardés dès leur première ouverture ; sans serveur, ceux déjà visités
 *   s'ouvrent encore (les autres n'auraient pas non plus leurs données).
 * - Données (/api/…), temps réel (/ws) : le réseau. L'interface garde elle-même les données pour la lecture hors
 *   ligne ; seules les images de l'API sont gardées ici (le réseau d'abord, la copie gardée s'il ne répond pas).
 */
const VERSION = '__VERSION__';
const CACHE = `fastboard-${VERSION}`;
/** Images gardées pour la lecture hors ligne : hors du nom versionné, elles survivent aux mises à jour. */
const IMAGES = 'fb-offline-images';
const IMAGES_MAX = 400;
/** De quoi ouvrir l'application sans réseau : la page, son script, ses styles, ses icônes. */
const SHELL = __SHELL__;

const OFFLINE_FR = '<h1>Hors ligne</h1><p>FastBoard a besoin du réseau pour s’ouvrir la première fois. Vérifiez la connexion, puis réessayez.</p>';
const OFFLINE_EN = '<h1>Offline</h1><p>FastBoard needs the network to open the first time. Check the connection, then try again.</p>';

function offlinePage() {
  const english = (self.navigator.language || '').toLowerCase().startsWith('en');
  const body = english ? OFFLINE_EN : OFFLINE_FR;
  const html = `<!doctype html><html lang="${english ? 'en' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FastBoard</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;background:#f8fafc;color:#0f172a;text-align:center}@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}}button{font:inherit;padding:.5rem 1rem;border-radius:8px;border:0;background:#4f46e5;color:#fff;cursor:pointer}</style></head><body><main>${body}<button onclick="location.reload()">${english ? 'Try again' : 'Réessayer'}</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Fichier par fichier : un seul absent n'empêche pas l'installation.
      await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('fastboard-') && key !== CACHE) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

/** Page de l'application : le réseau d'abord ; la dernière reçue (toutes les pages sont la même) si le réseau manque. */
async function page(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) || offlinePage();
  }
}

/** Ressource versionnée ou fichier de la coquille : gardée une fois reçue. */
async function stored(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Image de l'API (note, tableau, aperçu, avatar…) : le réseau d'abord ; la copie gardée s'il ne répond pas. */
async function image(request) {
  const cache = await caches.open(IMAGES);
  try {
    const response = await fetch(request);
    if (response.ok && (response.headers.get('content-type') || '').startsWith('image/')) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      // Les plus anciennes partent au-delà de la limite (l'ordre des clés est celui des ajouts).
      for (const old of keys.slice(0, Math.max(0, keys.length - IMAGES_MAX))) await cache.delete(old);
    }
    return response;
  } catch (error) {
    const kept = await cache.match(request);
    if (kept) return kept;
    throw error;
  }
}

// Déconnexion : les images gardées pour la lecture hors ligne partent avec la session.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'fastboard:clear-offline') event.waitUntil(caches.delete(IMAGES));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (api && request.destination === 'image') {
    event.respondWith(image(request));
    return;
  }
  // Données, fichiers privés, temps réel, ce service worker : toujours le réseau.
  if (api || url.pathname === '/ws' || url.pathname === '/sw.js') return;
  if (request.mode === 'navigate') {
    event.respondWith(page(event));
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) event.respondWith(stored(request));
});
