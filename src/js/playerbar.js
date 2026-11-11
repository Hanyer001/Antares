// Barra de reproducción basada en el estado y los controles de nowstate.js.
// Su aspecto se aplica mediante atributos de <html> y CSS.

import { PlayerView, volume_action } from "./rust-core.js";
import * as now from "./nowstate.js";
import * as prefs from "./prefs.js";

const SCRUB_STEPS = 1000;
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

let bar;
let scrub;
let view;
let tip;
let hovering = false;
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
  if (view.render(JSON.stringify(s), identity(s))) {
    renderTime(now.position());
    tip.hidden = true;
  }

  // El álbum se pide una vez por canción (y queda en caché): si no llega, no
  // pasa nada, solo no sale.
  const key = `${s.title}|${s.artist}`;
  if (key !== albumFor) {
    albumFor = key;
    $("pbar-album").textContent = "";
    if (s.title) loadAlbum(key, s.title);
  }

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
  view.update_time(current, duration ?? NaN);
  if (scrub.disabled) tip.hidden = true;
}

function showTip(ratio, x) {
  if (!tip || scrub.disabled || bar.hidden) return;
  const rect = scrub.getBoundingClientRect();
  tip.textContent = view.preview_label(ratio);
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

  view = new PlayerView(bar, false);
  const art = $("pbar-art");
  art.addEventListener("load", () => bar.classList.toggle("has-art", art.naturalWidth > 0));
  art.addEventListener("error", () => bar.classList.remove("has-art"));

  tip = document.createElement('output'); tip.className = 'pbar-tooltip'; tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true'); document.body.append(tip);

  const acts = { ...now.actions, ...handlers };
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    acts[button.dataset.act]?.(button);
  });

  const currentTrack = () => identity(now.snapshot());
  const cancel = () => { view.reset(true); tip.hidden = true; };
  scrub.addEventListener("pointerdown", () => view.begin(currentTrack()));
  scrub.addEventListener("input", () => {
    view.input(currentTrack());
    const preview = view.preview_ratio();
    if (preview != null) showTip(preview);
  });
  scrub.addEventListener("change", () => {
    const ratio = view.commit(currentTrack());
    if (ratio == null) renderTime(now.position());
    else acts.seek(ratio);
  });
  scrub.addEventListener("keydown", event => {
    if (event.key === "Escape") { cancel(); return; }
    const ratio = view.seek_key(event.key);
    if (ratio == null) return;
    event.preventDefault();
    acts.seek(ratio);
    showTip(ratio);
  });
  scrub.addEventListener("pointercancel", cancel);
  scrub.addEventListener("pointermove", event => {
    hovering = true;
    const rect = scrub.getBoundingClientRect();
    const pointer = (event.clientX - rect.left - 6) / Math.max(1, rect.width - 12);
    showTip(view.preview_ratio() ?? pointer, event.clientX);
  });
  scrub.addEventListener("pointerleave", () => {
    hovering = false;
    if (view.preview_ratio() == null && document.activeElement !== scrub) tip.hidden = true;
  });
  scrub.addEventListener("focus", () => showTip(scrub.valueAsNumber / SCRUB_STEPS));
  scrub.addEventListener("blur", () => { view.reset(false); tip.hidden = true; });
  window.addEventListener("resize", () => { tip.hidden = true; });
  document.addEventListener("pointerup", () => {
    view.end();
    if (!hovering && document.activeElement !== scrub) tip.hidden = true;
  });

  const vol = $("pbar-volume");
  vol.addEventListener("input", () => acts.setVolume(volume_action(vol.valueAsNumber, 0)));
  // La rueda sobre el volumen, como en la consola.
  bar.querySelector(".pbar__volume").addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep");
      acts.setVolume(volume_action(vol.valueAsNumber, event.deltaY < 0 ? step : -step));
    },
    { passive: false },
  );

  now.onChange(render);
  now.onTime(renderTime);
  renderTime(now.position());
}
