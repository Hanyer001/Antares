// Barra de reproducción basada en el estado y los controles de nowstate.js.
// Su aspecto se aplica mediante atributos de <html> y CSS.

import { formatTime } from "./format.js";
import * as now from "./nowstate.js";
import * as prefs from "./prefs.js";
import { clampRatio, timeline, keyboardSeek } from "./timeline.js";

const SCRUB_STEPS = 1000;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

let bar;
let scrub;
let scrubbing = false;
let lastArt = null;
let position = timeline(0, null);
let trackKey = '';
let cancelled = false;
let tip;
let hovering = false;
let pointerX = 0;
let previewCurrent = 0;
let gestureKey = '';
const identity = s => JSON.stringify([s.revision, s.title, s.artist]);

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
  artist.disabled = !s.hasTrack;

  const nextKey = identity(s);
  if (nextKey !== trackKey) {
    if (scrubbing) cancelled = true;
    scrubbing = false;
    trackKey = nextKey;
    renderTime(now.position());
    if (tip) tip.hidden = true;
  }

  if (s.artwork !== lastArt) {
    lastArt = s.artwork;
    const img = $("pbar-art");
    bar.classList.remove('has-art');
    img.onload = () => bar.classList.toggle('has-art', img.getAttribute('src') === lastArt);
    img.onerror = () => bar.classList.remove('has-art');
    if (s.artwork) img.src = s.artwork;
    else img.removeAttribute("src");
    if (img.complete && img.naturalWidth) bar.classList.add('has-art');
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
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(s.liked));
    } else if (act === "dislike") {
      b.disabled = !s.canRate;
      b.classList.toggle("is-on", s.disliked);
      b.setAttribute('aria-label', s.disliked ? 'Quitar «No me gusta»' : 'No me gusta');
      b.setAttribute('aria-pressed', String(s.disliked));
    } else if (act === "shuffle") {
      b.classList.toggle("is-on", s.shuffle);
      b.setAttribute('aria-pressed', String(s.shuffle));
    }
    else if (act === "repeat") {
      b.classList.toggle("is-on", s.repeat !== "off");
      b.classList.toggle("is-one", s.repeat === "one");
      b.title = { off: "Repetir: no", all: "Repetir: toda la cola", one: "Repetir: esta canción" }[s.repeat];
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(s.repeat !== 'off'));
    } else if (act === "more" || act === 'expand') b.disabled = !s.hasTrack;
    else if (act === 'mute') {
      b.setAttribute('aria-label', s.muted ? 'Activar sonido' : 'Silenciar');
      b.setAttribute('aria-pressed', String(s.muted));
      b.title = b.getAttribute('aria-label');
    }
  }

  bar.classList.toggle("is-muted", s.muted);
  const vol = $("pbar-volume");
  if (document.activeElement !== vol) vol.value = String(Math.round(s.volume * 100));
  vol.style.setProperty("--level", `${s.muted ? 0 : s.volume * 100}%`);
  vol.setAttribute('aria-valuetext', s.muted ? 'Silenciado' : `${Math.round(s.volume * 100)} %`);
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
  if (document.hidden || bar.hidden) return;
  position = timeline(current, duration);
  $("pbar-total").textContent = formatTime(position.duration);
  scrub.disabled = !position.duration;
  if (!position.duration && tip) tip.hidden = true;
  if (!position.duration && scrubbing) { scrubbing = false; cancelled = true; }
  if (!scrubbing) paintPosition(position.ratio);
}

function paintPosition(ratio) {
  ratio = clampRatio(ratio);
  scrub.value = String(Math.round(ratio * SCRUB_STEPS));
  scrub.style.setProperty('--played', `${(ratio * 100).toFixed(2)}%`);
  previewCurrent = position.duration ? ratio * position.duration : 0;
  const time = formatTime(previewCurrent);
  $('pbar-current').textContent = time;
  scrub.setAttribute('aria-valuetext', position.duration ? `${time} de ${formatTime(position.duration)}` : 'Duración no disponible');
}

function showTip(ratio, x) {
  if (!tip || scrub.disabled || bar.hidden) return;
  const rect = scrub.getBoundingClientRect();
  tip.textContent = formatTime(clampRatio(ratio) * position.duration);
  tip.hidden = false;
  tip.style.left = `${Math.max(40, Math.min(innerWidth - 40, x ?? rect.left + 6 + ratio * (rect.width - 12)))}px`;
  const above = rect.top > 48;
  tip.style.top = `${above ? rect.top - 8 : rect.bottom + 8}px`;
  tip.style.transform = `translate(-50%, ${above ? '-100%' : '0'})`;
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

  tip = document.createElement('output'); tip.className = 'pbar-tooltip'; tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true'); document.body.append(tip);

  const acts = { ...now.actions, ...handlers };
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    acts[button.dataset.act]?.(button);
  });

  // La posición: se ve moverse mientras se arrastra, y salta al soltar.
  scrub.addEventListener("pointerdown", () => { scrubbing = true; cancelled = false; gestureKey = identity(now.snapshot()); });
  scrub.addEventListener("input", () => {
    if (cancelled) return;
    if (!scrubbing) gestureKey = identity(now.snapshot());
    scrubbing = true;
    paintPosition(Number(scrub.value) / SCRUB_STEPS);
    showTip(Number(scrub.value) / SCRUB_STEPS);
  });
  scrub.addEventListener("change", () => {
    // Leer ahora también cubre metadatos recién cambiados cuyo aviso agrupado
    // todavía no ha llegado: un gesto viejo no debe saltar en la pista nueva.
    if (cancelled || gestureKey !== identity(now.snapshot())) { scrubbing = false; renderTime(now.position()); return; }
    const ratio = clampRatio(Number(scrub.value) / SCRUB_STEPS);
    scrubbing = false;
    acts.seek(ratio);
  });
  scrub.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      cancelled = true; scrubbing = false; paintPosition(position.ratio); tip.hidden = true; return;
    }
    const ratio = keyboardSeek(event.key, previewCurrent, position.duration);
    if (ratio === null) return;
    event.preventDefault(); cancelled = false; scrubbing = false;
    paintPosition(ratio); acts.seek(ratio); showTip(ratio);
  });
  scrub.addEventListener('pointercancel', () => { cancelled = true; scrubbing = false; paintPosition(position.ratio); tip.hidden = true; });
  scrub.addEventListener('pointermove', event => {
    hovering = true; pointerX = event.clientX;
    const rect = scrub.getBoundingClientRect();
    showTip(scrubbing ? Number(scrub.value) / SCRUB_STEPS : (pointerX - rect.left - 6) / Math.max(1, rect.width - 12), pointerX);
  });
  scrub.addEventListener('pointerleave', () => { hovering = false; if (!scrubbing && document.activeElement !== scrub) tip.hidden = true; });
  scrub.addEventListener('focus', () => showTip(Number(scrub.value) / SCRUB_STEPS));
  scrub.addEventListener('blur', () => { scrubbing = false; cancelled = false; paintPosition(position.ratio); tip.hidden = true; });
  window.addEventListener('resize', () => { tip.hidden = true; });
  document.addEventListener('pointerup', () => {
    // También cubre soltar fuera del rango; el evento change nativo confirma.
    scrubbing = false;
    if (!hovering && document.activeElement !== scrub) tip.hidden = true;
  });

  const vol = $("pbar-volume");
  vol.addEventListener("input", () => acts.setVolume(Number(vol.value) / 100));
  // La rueda sobre el volumen, como en la consola.
  bar.querySelector(".pbar__volume").addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep") / 100;
      acts.setVolume(clampRatio(Number(vol.value) / 100 + (event.deltaY < 0 ? step : -step)));
    },
    { passive: false },
  );

  now.onChange(render);
  now.onTime(renderTime);
  renderTime(now.position());
}
