const prefix = `antares-web:${self.registration.scope}:`;
const version = "__VERSION__";
const cacheName = prefix + version;
const coverCache = `antares-covers:${self.registration.scope}`;
const assets = __ASSETS__;
const shell = new Set(assets.map(path => new URL(path, self.registration.scope).href));
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "VERSION") event.ports[0]?.postMessage({ version });
});

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(key => key.startsWith(prefix) && key !== cacheName);
    // Una pestaña anterior puede seguir necesitando sus módulos diferidos.
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function publicCover(request) {
  const cache = await caches.open(coverCache);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 64)).map(key => cache.delete(key)));
    } catch { /* La portada aún puede mostrarse aunque se agotó la cuota. */ }
  }
  return response;
}

async function versionedAsset(request) {
  const current = await caches.open(cacheName);
  const hit = await current.match(request);
  if (hit) return hit;
  const previous = (await caches.keys()).filter(key => key.startsWith(prefix) && key !== cacheName);
  for (const name of previous) {
    const cached = await (await caches.open(name)).match(request);
    if (cached) return cached;
  }
  return fetch(request);
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("Range")) return;
  const url = new URL(request.url);
  if (request.destination === "image" && url.protocol === "https:"
      && (url.hostname === "i.ytimg.com" || url.hostname === "img.youtube.com")) {
    event.respondWith(publicCover(request));
    return;
  }
  if (request.destination === 'font' && url.origin === self.location.origin) {
    event.respondWith(caches.open(cacheName).then(async cache => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  if (request.mode === "navigate" && url.href.startsWith(self.registration.scope) && !url.pathname.includes("/api/")) {
    event.respondWith(fetch(request).then(response => {
      if (response.status >= 500) throw new Error("Servidor temporalmente no disponible");
      return response;
    }).catch(async () => (await caches.open(cacheName)).match("./index.html")));
  } else if (shell.has(request.url) || (url.href.startsWith(self.registration.scope)
      && (/\/assets\/[^/]+-[A-Z0-9]+\.js$/.test(url.pathname)
        || /\/engine\/antares_core_bg(?:-[a-f0-9]+)?\.wasm$/.test(url.pathname)
        || url.searchParams.has("v")
        && /\/(?:[^/]+\.css|boot-theme\.js)$/.test(url.pathname)))) {
    event.respondWith(versionedAsset(request));
  }
});
