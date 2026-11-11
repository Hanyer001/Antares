// Guarda la cola, la pista y su posición en el almacenamiento del WebView.
// Al abrir, restaura la pista en pausa. La URL de audio se resuelve al reproducir
// porque los enlaces directos caducan.

import { key } from "./user.js";
import { WEB } from "./platform.js";
import { readSession, sessionForStorage } from "./session-model.js";
import { persistSession, readCachedSession } from "./web-storage.js";

/** Cada usuario del PC retoma lo suyo. */
const storageKey = () => key("antares.session");

/**
 * @param {object} state
 * @param {object} state.queue  `queue.snapshot()`
 * @param {object|null} state.track  Lo que suena.
 * @param {number} state.time   Segundo por el que iba.
 * @param {object[]} state.picks  Las semillas de las recomendaciones.
 */
export function save(state) {
  try {
    const saved = sessionForStorage(state, Date.now());
    if (!saved) return;
    if (WEB) return persistSession(storageKey(), saved);
    localStorage.setItem(storageKey(), JSON.stringify(saved));
  } catch {
    // Sin almacenamiento, o lleno: la próxima vez se empieza de cero.
  }
}

export function load() {
  try {
    const saved = WEB ? readCachedSession(storageKey()) : JSON.parse(localStorage.getItem(storageKey()) ?? "null");
    return readSession(saved);
  } catch {
    return null;
  }
}

export function replace(state) {
  if (WEB) persistSession(storageKey(), state);
  else if (state) localStorage.setItem(storageKey(), JSON.stringify(state));
  else localStorage.removeItem(storageKey());
}
