// Estado visual de la interfaz: mensajes, indicadores y metadatos de la pista.
// Los controles de audio se gestionan en player.js.

import { els } from "./dom.js";
import { toast } from "./toast.js";

/** Título de la vista central y el dato pequeño que lo acompaña. */
export function setView(title, meta = "") {
  els.viewTitle.textContent = title;
  els.viewMeta.textContent = meta;
}

/**
 * Un mensaje para el usuario: un aviso abajo a la derecha (toast.js), no una
 * línea fija bajo la canción. Todos comparten sitio: "Preparando la radio…"
 * pasa a "Radio de «X» · 25 canciones" en el mismo aviso.
 *
 * @param {"info"|"busy"|"error"|"ok"} tone  "busy": algo en curso.
 */
export function setStatus(message, tone = "info") {
  toast(message, { tone, key: "status" });
}

/**
 * El punto de la cabecera, y el aro del botón de play mientras carga.
 * @param {"idle"|"busy"|"playing"|"error"} state
 */
export function setEngine(state) {
  els.engine.dataset.state = state;
  els.play.classList.toggle("is-loading", state === "busy");
}

/**
 * Bloquea el botón de búsqueda y muestra su spinner.
 *
 * El input NO se deshabilita a propósito: poder seguir escribiendo la siguiente
 * búsqueda mientras la actual resuelve es parte de que la espera se note menos.
 */
export function setBusy(isBusy) {
  els.button.disabled = isBusy;
  els.button.classList.toggle("is-busy", isBusy);
}

/** Habilita play y la barra solo cuando hay algo que reproducir. */
export function setTransportEnabled(enabled) {
  els.play.disabled = !enabled;
  els.scrub.disabled = !enabled;
}

/**
 * Anterior y siguiente dependen de la cola, no de que haya audio: con una sola
 * pista cargada ambos siguen apagados, y es correcto que se vea.
 */
export function setQueueControls({ hasPrev, hasNext }) {
  els.prev.disabled = !hasPrev;
  els.next.disabled = !hasNext;
}

/**
 * Corazón y "no me gusta" de la consola.
 *
 * @param {"none"|"like"|"dislike"} rating
 * @param {boolean} enabled Solo hay algo que valorar si la pista tiene id.
 */
export function setRating(rating, enabled) {
  els.like.disabled = !enabled;
  els.dislike.disabled = !enabled;

  const liked = rating === "like";
  const disliked = rating === "dislike";

  els.like.setAttribute("aria-pressed", String(liked));
  els.dislike.setAttribute("aria-pressed", String(disliked));

  els.like.setAttribute("aria-label", liked ? "Quitar de Me gusta" : "Me gusta");
  els.like.title = els.like.getAttribute("aria-label");
  els.dislike.setAttribute("aria-label", disliked ? "Quitar «No me gusta»" : "No me gusta");
  els.dislike.title = els.dislike.getAttribute("aria-label");
}

const REPEAT_LABELS = {
  off: "Repetir: no",
  all: "Repetir: toda la cola",
  one: "Repetir: esta canción",
};

/**
 * Botones de aleatorio y repetir.
 *
 * @param {{ shuffle: boolean, repeat: "off"|"all"|"one" }} modes
 */
export function setModes({ shuffle, repeat }) {
  els.shuffle.setAttribute("aria-pressed", String(shuffle));
  els.shuffle.classList.toggle("is-active", shuffle);
  els.shuffle.title = `Aleatorio: ${shuffle ? "sí" : "no"} (S)`;

  els.repeat.dataset.repeat = repeat;
  els.repeat.classList.toggle("is-active", repeat !== "off");
  els.repeat.setAttribute("aria-label", REPEAT_LABELS[repeat]);
  els.repeat.title = `${REPEAT_LABELS[repeat]} (R)`;
}

/**
 * Título y canal de la pista. Llamar sin argumentos devuelve la tarjeta a su
 * estado vacío.
 *
 * El canal se deja como cadena vacía cuando no lo hay: la regla `:empty` del CSS
 * colapsa el elemento, así que no queda un hueco flotando bajo el título.
 */
export function setTrack({ title, uploader } = {}) {
  els.title.textContent = title || "Sin reproducción";
  els.title.classList.toggle("is-empty", !title);
  els.by.textContent = uploader || "";
}
