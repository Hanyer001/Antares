// Sincroniza los botones de la barra de tareas de Windows con la consola.
// Rust los dibuja; sus eventos activan los controles correspondientes.

import { els } from "./dom.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** Lo último enviado, para no llamar a Rust si nada cambió. */
let last = "";
let pending = false;

/**
 * El título de la ventana: "Artista - Canción" como en Spotify. Muchos
 * títulos de YouTube ya llevan el artista ("Oasis - Wonderwall"): entonces
 * va tal cual.
 */
export function windowTitle(title, artist) {
  if (!title) return "Antares";
  if (!artist || title.toLowerCase().includes(artist.toLowerCase())) return title;
  return `${artist} - ${title}`;
}

function snapshot() {
  const hasTitle = !els.title.classList.contains("is-empty");
  return {
    title: windowTitle(hasTitle ? els.title.textContent.trim() : "", els.by.textContent.trim()),
    state: {
      hasTrack: !els.play.disabled,
      playing: document.body.classList.contains("is-playing"),
      liked: els.like.getAttribute("aria-pressed") === "true",
      canLike: !els.like.disabled,
      hasPrev: !els.prev.disabled,
      hasNext: !els.next.disabled,
    },
  };
}

/** Varios cambios seguidos (una canción nueva toca casi todo) van en uno. */
function schedule() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const now = snapshot();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    invoke("set_thumbbar", now).catch(() => {});
  });
}

export function initThumbbar() {
  const observer = new MutationObserver(schedule);
  const attrs = { attributes: true, attributeFilter: ["disabled", "aria-pressed", "class"] };

  for (const button of [els.like, els.prev, els.next, els.play]) observer.observe(button, attrs);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  observer.observe(els.title, { childList: true, characterData: true, subtree: true, attributes: true });
  observer.observe(els.by, { childList: true, characterData: true, subtree: true });

  const buttons = { like: els.like, prev: els.prev, toggle: els.play, next: els.next };
  listen("thumbbar", ({ payload }) => {
    const button = buttons[payload];
    if (button && !button.disabled) button.click();
  });

  schedule();
}
