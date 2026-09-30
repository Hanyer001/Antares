// Avisos temporales con acciones opcionales.
// Una key permite actualizar un aviso existente, por ejemplo durante una importación.

import { els } from "./dom.js";
import { icon } from "./icons.js";

const SHOW_MS = 3500;
/** Con un botón ("Deshacer", "Ver lista") se deja más tiempo para pulsarlo. */
const WITH_ACTION_MS = 6500;
/** "En curso": se queda hasta que otro aviso con su `key` lo sustituya. */
const BUSY_MS = 90_000;
const LEAVE_MS = 180;
/** Más de tres a la vez ya no se leen: se van los más viejos. */
const MAX_VISIBLE = 3;

function dismiss(el) {
  if (el.classList.contains("is-leaving")) return;
  clearTimeout(el.timer);
  el.classList.add("is-leaving");
  setTimeout(() => el.remove(), LEAVE_MS);
}

function arm(el, ms) {
  clearTimeout(el.timer);
  el.timer = setTimeout(() => dismiss(el), ms);
}

function mark(tone) {
  const box = document.createElement("span");
  box.className = "toast__mark";
  if (tone === "busy") {
    box.append(Object.assign(document.createElement("span"), { className: "toast__spinner" }));
  } else if (tone === "info") {
    box.textContent = "i";
  } else {
    box.append(icon(tone === "ok" ? "check" : tone === "warn" ? "list" : "close"));
  }
  return box;
}

/**
 * Enseña un aviso.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {"ok"|"info"|"busy"|"warn"|"error"} [opts.tone]  "warn": no pasó lo
 *        que se pidió, pero no es un fallo (la canción ya estaba en la lista).
 *        "busy": algo en curso ("Preparando la radio…").
 * @param {{ label: string, onClick: Function }} [opts.action]
 * @param {string} [opts.key]  Avisos de lo mismo: el nuevo sustituye al viejo.
 * @param {number} [opts.ms]    Cuánto se queda, si no vale el de siempre.
 */
export function toast(text, { tone = "ok", action = null, key = null, ms = null } = {}) {
  const box = els.toasts;
  if (!box) return;

  // El mismo aviso dos veces seguidas, o uno nuevo de lo mismo, no se apila.
  let el = null;
  for (const old of [...box.children]) {
    if (old.classList.contains("is-leaving")) continue;
    if (key && old.dataset.key === key && !el) el = old;
    else if (old.dataset.text === text) old.remove();
  }

  const fresh = !el;
  if (fresh) {
    el = document.createElement("div");
    el.addEventListener("pointerenter", () => clearTimeout(el.timer));
    el.addEventListener("pointerleave", () => arm(el, el.showMs));
  }

  el.className = `toast toast--${tone}`;
  el.dataset.text = text;
  if (key) el.dataset.key = key;
  el.setAttribute("role", tone === "error" ? "alert" : "status");

  const message = document.createElement("span");
  message.className = "toast__text";
  message.textContent = text;

  el.replaceChildren(mark(tone), message);

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast__action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      dismiss(el);
      action.onClick();
    });
    el.append(button);
  }

  // Con el ratón encima no se va: puede que lo esté leyendo o yendo al botón.
  el.showMs = ms ?? (tone === "busy" ? BUSY_MS : action ? WITH_ACTION_MS : SHOW_MS);
  if (fresh) {
    box.append(el);
    while (box.children.length > MAX_VISIBLE) box.firstElementChild.remove();
  }
  if (!el.matches(":hover")) arm(el, el.showMs);
}

/** Quita el aviso de `key`, si lo hay (algo en curso que se canceló). */
export function clearToast(key) {
  for (const el of els.toasts?.children ?? []) {
    if (el.dataset.key === key) dismiss(el);
  }
}
