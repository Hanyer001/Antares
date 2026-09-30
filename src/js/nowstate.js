// Lee el estado de la consola y reutiliza sus controles en la barra
// de reproducción y el mini reproductor.

import { els } from "./dom.js";
import * as player from "./player.js";

/** El estado de un vistazo. */
export function snapshot() {
  const hasTitle = !els.title.classList.contains("is-empty");
  return {
    title: hasTitle ? els.title.textContent.trim() : "",
    // Sin el " - Topic" de los canales automáticos de YouTube.
    artist: els.by.textContent.trim().replace(/ - Topic$/, ""),
    artwork: els.artwork.classList.contains("has-art") ? els.artImg.getAttribute("src") : null,
    hasTrack: !els.play.disabled,
    playing: document.body.classList.contains("is-playing"),
    loading: els.play.classList.contains("is-loading"),
    liked: els.like.getAttribute("aria-pressed") === "true",
    disliked: els.dislike.getAttribute("aria-pressed") === "true",
    canRate: !els.like.disabled,
    hasPrev: !els.prev.disabled,
    hasNext: !els.next.disabled,
    shuffle: els.shuffle.getAttribute("aria-pressed") === "true",
    repeat: els.repeat.dataset.repeat || "off",
    volume: Number(els.volume.value) / 100,
    muted: els.volume.classList.contains("is-muted"),
  };
}

/** Por dónde va: segundos y duración (o null si aún no se sabe). */
export function position() {
  const duration = player.duration();
  return {
    current: player.currentTime(),
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

/** El "…" de lo que suena lo pone main.js: es el menú de cualquier fila. */
let moreMenu = () => {};

export function setMoreMenu(open) {
  moreMenu = open;
}

const click = (el) => () => {
  if (!el.disabled) el.click();
};

export const actions = {
  toggle: click(els.play),
  prev: click(els.prev),
  next: click(els.next),
  like: click(els.like),
  dislike: click(els.dislike),
  shuffle: click(els.shuffle),
  repeat: click(els.repeat),
  mute: click(els.mute),
  artist: () => els.by.click(),
  more: (button) => moreMenu(button),
  /** @param {number} ratio 0..1 de la canción. */
  seek(ratio) {
    const { duration } = position();
    if (duration) player.seek(ratio * duration);
  },
  /** @param {number} level 0..1, como el deslizador de la consola. */
  setVolume(level) {
    els.volume.value = String(Math.round(Math.min(Math.max(level, 0), 1) * 100));
    els.volume.dispatchEvent(new Event("input"));
  },
};

// --- Avisos --------------------------------------------------------------

const stateListeners = [];
const timeListeners = [];
let pending = false;

function schedule() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const state = snapshot();
    for (const listener of stateListeners) listener(state);
  });
}

/** Cada vez que cambia algo de la consola (varios cambios seguidos, uno). */
export function onChange(callback) {
  stateListeners.push(callback);
  callback(snapshot());
}

/** Con cada avance de la canción. */
export function onTime(callback) {
  timeListeners.push(callback);
}

export function initNowState() {
  const observer = new MutationObserver(schedule);
  const attrs = {
    attributes: true,
    attributeFilter: ["disabled", "aria-pressed", "class", "data-repeat", "src", "aria-label"],
  };
  for (const el of [els.like, els.dislike, els.prev, els.next, els.play, els.shuffle, els.repeat, els.artwork, els.artImg]) {
    observer.observe(el, attrs);
  }
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  observer.observe(els.title, { childList: true, characterData: true, subtree: true, attributes: true });
  observer.observe(els.by, { childList: true, characterData: true, subtree: true });
  // El volumen cambia su valor sin tocar atributos: se escucha el evento.
  els.volume.addEventListener("input", schedule);
  observer.observe(els.volume, { attributes: true, attributeFilter: ["class", "style"] });

  const tick = () => {
    const pos = position();
    for (const listener of timeListeners) listener(pos);
  };
  player.on("time", tick);
  // Una canción nueva o un salto se ven aunque esté en pausa.
  for (const deck of [els.audio, els.audioB]) {
    deck.addEventListener("loadedmetadata", tick);
    deck.addEventListener("emptied", tick);
    deck.addEventListener("seeked", tick);
  }
}
