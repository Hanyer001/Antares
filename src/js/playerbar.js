// Barra de reproducción basada en el estado y los controles de nowstate.js.
// Su aspecto se aplica mediante atributos de <html> y CSS.

import { formatTime } from "./format.js";
import * as now from "./nowstate.js";
import * as prefs from "./prefs.js";

const SCRUB_STEPS = 1000;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

let bar;
let scrub;
let scrubbing = false;
let lastArt = null;

/** La barra solo en escritorio: en Android ya hay reproductor abajo. */
let available = true;

/** Lo que va detrás del artista: "Álbum", si se conoce. Lo pide main.js. */
let albumOf = async () => null;
let albumFor = "";

function applyPrefs() {
  const p = prefs.get("player");
  const on = available && p.bar;

  bar.hidden = !on;
  root.toggleAttribute("data-bar", on);
  root.dataset.barPosition = p.barPosition;
  root.dataset.barLayout = p.barProgress;
  root.dataset.barSize = p.barSize;
  root.dataset.barStyle = p.barStyle;
  root.dataset.barShape = p.barShape;
  // "auto": el de cada diseño (círculo en el centrado, icono en el otro).
  root.dataset.barPlay = p.barPlay === "auto" ? (p.barProgress === "inline" ? "circle" : "plain") : p.barPlay;
  root.dataset.barAccent = p.barAccent;

  const hide = [];
  if (!p.barArtwork) hide.push("art");
  if (!p.barAlbum) hide.push("album");
  if (!p.barRate) hide.push("rate");
  if (!p.barVolume) hide.push("volume");
  if (!p.barModes) hide.push("modes");
  if (!p.barExtras) hide.push("extras");
  root.dataset.barHide = hide.join(" ");

  // Con la barra, la consola sin sus controles (salvo que se pidan).
  root.toggleAttribute("data-console-lean", on && !p.consoleControls);
}

function render(s) {
  bar.classList.toggle("is-playing", s.playing);
  bar.classList.toggle("is-loading", s.loading);
  bar.classList.toggle("is-empty", !s.hasTrack);

  $("pbar-title").textContent = s.title || "Sin reproducción";
  $("pbar-title").title = s.title;
  const artist = $("pbar-artist");
  artist.textContent = s.artist;
  artist.hidden = !s.artist;

  if (s.artwork !== lastArt) {
    lastArt = s.artwork;
    const img = $("pbar-art");
    if (s.artwork) img.src = s.artwork;
    else img.removeAttribute("src");
    bar.classList.toggle("has-art", Boolean(s.artwork));
  }

  // El álbum se pide una vez por canción (y queda en caché): si no llega, no
  // pasa nada, solo no sale.
  const key = `${s.title}|${s.artist}`;
  if (key !== albumFor) {
    albumFor = key;
    $("pbar-album").textContent = "";
    if (s.title) loadAlbum(key, s.title);
  }

  for (const b of bar.querySelectorAll("[data-act]")) {
    const act = b.dataset.act;
    if (act === "toggle") {
      b.disabled = !s.hasTrack;
      b.setAttribute("aria-label", s.playing ? "Pausar" : "Reproducir");
      b.title = b.getAttribute("aria-label");
    } else if (act === "prev") b.disabled = !s.hasPrev;
    else if (act === "next") b.disabled = !s.hasNext;
    else if (act === "like") {
      b.disabled = !s.canRate;
      b.classList.toggle("is-on", s.liked);
      b.title = s.liked ? "Quitar de Me gusta" : "Me gusta";
    } else if (act === "dislike") {
      b.disabled = !s.canRate;
      b.classList.toggle("is-on", s.disliked);
    } else if (act === "shuffle") b.classList.toggle("is-on", s.shuffle);
    else if (act === "repeat") {
      b.classList.toggle("is-on", s.repeat !== "off");
      b.classList.toggle("is-one", s.repeat === "one");
      b.title = { off: "Repetir: no", all: "Repetir: toda la cola", one: "Repetir: esta canción" }[s.repeat];
    } else if (act === "more") b.disabled = !s.hasTrack;
  }

  bar.classList.toggle("is-muted", s.muted);
  const vol = $("pbar-volume");
  if (document.activeElement !== vol) vol.value = String(Math.round(s.volume * 100));
  vol.style.setProperty("--level", `${s.muted ? 0 : s.volume * 100}%`);
}

/**
 * El título cambia antes de que la canción esté cargada del todo: `albumOf`
 * falla mientras tanto y se reintenta un poco después.
 */
async function loadAlbum(key, title, tries = 8) {
  try {
    const album = await albumOf(title);
    // Un sencillo se llama como la canción: repetirlo no dice nada.
    if (albumFor === key && album && album.toLowerCase() !== title.toLowerCase()) {
      $("pbar-album").textContent = album;
    }
  } catch {
    if (tries > 1 && albumFor === key) setTimeout(() => loadAlbum(key, title, tries - 1), 1200);
  }
}

function renderTime({ current, duration }) {
  $("pbar-current").textContent = formatTime(current);
  $("pbar-total").textContent = duration ? formatTime(duration) : "0:00";
  const ratio = duration ? Math.min(current / duration, 1) : 0;
  if (!scrubbing) scrub.value = String(Math.round(ratio * SCRUB_STEPS));
  scrub.style.setProperty("--played", `${(ratio * 100).toFixed(2)}%`);
  scrub.disabled = !duration;
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled  false en Android.
 * @param {Record<string, Function>} opts.handlers  Lo que la consola no tiene
 *   como botón: `lyrics`, `queue`, `mini`, `expand`.
 * @param {() => Promise<string|null>} opts.album  El álbum de lo que suena.
 */
export function initPlayerBar({ enabled = true, handlers = {}, album } = {}) {
  bar = $("playerbar");
  scrub = $("pbar-scrub");
  available = enabled;
  if (album) albumOf = album;

  applyPrefs();
  prefs.on("player", applyPrefs);
  if (!available) return;

  const acts = { ...now.actions, ...handlers };
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    acts[button.dataset.act]?.(button);
  });

  // La posición: se ve moverse mientras se arrastra, y salta al soltar.
  scrub.addEventListener("pointerdown", () => (scrubbing = true));
  scrub.addEventListener("input", () => {
    scrub.style.setProperty("--played", `${Number(scrub.value) / 10}%`);
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
    now.actions.seek(Number(scrub.value) / SCRUB_STEPS);
  });

  const vol = $("pbar-volume");
  vol.addEventListener("input", () => now.actions.setVolume(Number(vol.value) / 100));
  // La rueda sobre el volumen, como en la consola.
  bar.querySelector(".pbar__volume").addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep") / 100;
      now.actions.setVolume(Number(vol.value) / 100 + (event.deltaY < 0 ? step : -step));
    },
    { passive: false },
  );

  now.onChange(render);
  now.onTime(renderTime);
  renderTime(now.position());
}
