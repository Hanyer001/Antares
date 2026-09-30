// Guarda la cola, la pista y su posición en el almacenamiento del WebView.
// Al abrir, restaura la pista en pausa. La URL de audio se resuelve al reproducir
// porque los enlaces directos caducan.

import { key } from "./user.js";

/** Cada usuario del PC retoma lo suyo. */
const storageKey = () => key("antares.session");

/**
 * Una cola importada puede ser enorme: se guardan como mucho estas pistas, en
 * una ventana que empieza un poco antes de la que suena.
 */
const MAX_ITEMS = 500;
const KEEP_BEFORE = 50;

/**
 * @param {object} state
 * @param {object} state.queue  `queue.snapshot()`
 * @param {object|null} state.track  Lo que suena.
 * @param {number} state.time   Segundo por el que iba.
 * @param {object[]} state.picks  Las semillas de las recomendaciones.
 */
export function save(state) {
  const queue = state.queue;
  const from = queue.items.length > MAX_ITEMS ? Math.max(queue.index - KEEP_BEFORE, 0) : 0;
  const trimmed = {
    ...queue,
    items: queue.items.slice(from, from + MAX_ITEMS),
    original: queue.original.slice(0, MAX_ITEMS),
    index: queue.index - from,
  };

  try {
    localStorage.setItem(storageKey(), JSON.stringify({ ...state, queue: trimmed, savedAt: Date.now() }));
  } catch {
    // Sin almacenamiento, o lleno: la próxima vez se empieza de cero.
  }
}

export function load() {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) ?? "null");
  } catch {
    return null;
  }
}
