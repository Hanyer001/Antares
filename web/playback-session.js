import { cleanSession } from "./shared/session-model.js";

const KEY = "antares.web.session";
const MAX_ITEMS = 500;
const ID = /^[\w-]{11}$/;
const DATABASE = "antares.web";
const STORE = "playback";
let connection;

function sessionDatabase() {
  connection ??= new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
  return connection;
}

function legacySession() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

function storedSession() {
  return sessionDatabase().then(database => database && new Promise(resolve => {
    const request = database.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  })).catch(() => null);
}

async function persistSession(state) {
  try {
    const database = await sessionDatabase();
    if (!database) return;
    const tx = database.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const previous = store.get(KEY);
    previous.onsuccess = () => {
      if ((previous.result?.savedAt ?? 0) <= (state.savedAt ?? 0)) store.put(state, KEY);
    };
    tx.oncomplete = () => {
      // Confirmar la lectura antes de retirar el respaldo de la versión anterior.
      storedSession().then(confirmed => {
        if (!cleanSession(confirmed) || confirmed.savedAt < state.savedAt) return;
        const legacy = legacySession();
        if (legacy && (legacy.savedAt ?? 0) <= (confirmed.savedAt ?? 0)) localStorage.removeItem(KEY);
      }).catch(() => { /* La copia local sigue disponible. */ });
    };
  } catch { /* Se mantiene la copia síncrona para recuperar al volver. */ }
}

export function youtubeId(input) {
  if (ID.test(input)) return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol)) return null;
  const [, first, second] = url.pathname.split("/");
  let id;
  if (url.hostname === "youtu.be") id = first;
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(url.hostname)) {
    if (first === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(first)) id = second;
  }
  return ID.test(id ?? "") ? id : null;
}

export async function readSession() {
  try {
    const legacy = legacySession();
    let timeout;
    const current = await Promise.race([
      storedSession(),
      new Promise(resolve => { timeout = setTimeout(() => resolve(null), 750); }),
    ]).finally(() => clearTimeout(timeout));
    const preferLegacy = legacy && (!current || (legacy.savedAt ?? 0) > (current.savedAt ?? 0));
    let raw = preferLegacy ? legacy : current;
    let session = cleanSession(raw);
    if (!session) { raw = legacy; session = cleanSession(raw); }
    if (!session) return null;
    if (preferLegacy) persistSession(legacy);
    const items = session.queue.items.filter(track => ID.test(track.id));
    const index = items.findIndex(track => track.id === session.track?.id);
    return {
      queue: { ...session.queue, items, index, artistOnly: raw?.queue?.artistOnly === true,
        original: session.queue.original.filter(track => ID.test(track.id)) },
      time: index < 0 ? 0 : session.time,
      repeat: raw?.repeat,
    };
  } catch {
    return null;
  }
}

export function writeSession(queue, track, time, repeat) {
  const start = queue.items.length > MAX_ITEMS ? Math.max(queue.index - 50, 0) : 0;
  const items = queue.items.slice(start, start + MAX_ITEMS);
  const ids = new Set(items.map(track => track.id));
  const original = queue.original.filter(track => ids.has(track.id));
  const state = {
    queue: { ...queue, items, original, index: queue.index - start },
    track, time, repeat, savedAt: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // El navegador puede bloquear el almacenamiento o quedarse sin espacio.
  }
  persistSession(state);
}
