// Reproductor en ventana pequeña, con vista de carátula o compacta.
// Comparte estado y controles con la consola a través de nowstate.js.
// La ventana se puede arrastrar desde las zonas sin controles.

import { formatTime } from "./format.js";
import * as now from "./nowstate.js";
import * as prefs from "./prefs.js";

const SCRUB_STEPS = 1000;
/** Sin tocar nada, el volumen vuelve a ser los controles. */
const VOLUME_IDLE_MS = 3500;

const root = document.documentElement;
const $ = (id) => document.getElementById(id);

let mini;
let scrub;
let scrubbing = false;
let volumeTimer = null;

function applyPrefs() {
  const p = prefs.get("player");
  root.dataset.miniStyle = p.miniStyle;
  root.dataset.miniControls = p.miniControls;
  root.dataset.miniAlign = p.miniAlign;
  root.dataset.miniShade = p.miniShade;
  mini.classList.toggle("show-lyrics", p.miniLyrics);
  mini.querySelector('[data-act="lyrics"]').classList.toggle("is-on", p.miniLyrics);
}

function render(s) {
  mini.classList.toggle("is-playing", s.playing);
  mini.classList.toggle("is-loading", s.loading);
  mini.classList.toggle("is-muted", s.muted);
  mini.classList.toggle("has-art", Boolean(s.artwork));

  $("mini-title").textContent = s.title || "Sin reproducción";
  $("mini-title").title = s.title;
  $("mini-artist").textContent = s.artist;

  const url = s.artwork ? `url("${s.artwork}")` : "none";
  if ($("mini-bg").style.backgroundImage !== url) {
    $("mini-bg").style.backgroundImage = url;
    if (s.artwork) $("mini-art").src = s.artwork;
    else $("mini-art").removeAttribute("src");
  }

  for (const b of mini.querySelectorAll("[data-act]")) {
    const act = b.dataset.act;
    if (act === "toggle") {
      b.disabled = !s.hasTrack;
      b.setAttribute("aria-label", s.playing ? "Pausar" : "Reproducir");
      b.title = b.getAttribute("aria-label");
    } else if (act === "prev") b.disabled = !s.hasPrev;
    else if (act === "next") b.disabled = !s.hasNext;
    else if (act === "more") b.disabled = !s.hasTrack;
  }

  const vol = $("mini-vol");
  if (document.activeElement !== vol) vol.value = String(Math.round(s.volume * 100));
  vol.style.setProperty("--level", `${s.muted ? 0 : s.volume * 100}%`);
}

function renderTime({ current, duration }) {
  $("mini-current").textContent = formatTime(current);
  // Como Apple: lo que falta, no lo que dura.
  $("mini-remaining").textContent = duration ? `-${formatTime(Math.max(duration - current, 0))}` : "-0:00";
  const ratio = duration ? Math.min(current / duration, 1) : 0;
  if (!scrubbing) scrub.value = String(Math.round(ratio * SCRUB_STEPS));
  scrub.style.setProperty("--played", `${(ratio * 100).toFixed(2)}%`);
  scrub.disabled = !duration;
}

function renderLine(line) {
  $("mini-line").textContent = line?.text || (line ? "♪" : "");
  $("mini-line-next").textContent = line?.next ?? "";
  mini.classList.toggle("has-line", Boolean(line));
}

// --- Volumen: ocupa el sitio de los controles mientras se ajusta ----------

function showVolume(show) {
  clearTimeout(volumeTimer);
  $("mini-volume").hidden = !show;
  mini.classList.toggle("is-volume", show);
  if (show) volumeTimer = setTimeout(() => showVolume(false), VOLUME_IDLE_MS);
}

/** Arrastrar la ventana desde cualquier sitio que no sea un control. */
function bindDrag() {
  const { getCurrentWindow } = window.__TAURI__.window;
  mini.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, a")) return;
    getCurrentWindow()
      .startDragging()
      .catch(() => {});
  });
}

/**
 * @param {object} opts
 * @param {() => void} opts.restore  Volver a la ventana normal.
 * @param {() => void} opts.queue    Volver y abrir la cola.
 * @param {(cb: Function) => void} opts.onLyricLine  El verso que suena.
 */
export function initMiniPlayer({ restore, queue, onLyricLine }) {
  mini = $("miniplayer");
  scrub = $("mini-scrub");

  applyPrefs();
  prefs.on("player", applyPrefs);

  const { getCurrentWindow } = window.__TAURI__.window;
  const acts = {
    ...now.actions,
    restore,
    queue,
    // Cerrar hace lo mismo que la ✕ de la ventana normal: a la bandeja si
    // está puesto, o salir.
    close: () => getCurrentWindow().close().catch(() => {}),
    style: () =>
      prefs.set("player.miniStyle", prefs.get("player.miniStyle") === "artwork" ? "compact" : "artwork"),
    lyrics: () => prefs.set("player.miniLyrics", !prefs.get("player.miniLyrics")),
    volume: () => showVolume($("mini-volume").hidden),
  };

  mini.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    acts[button.dataset.act]?.(button);
  });
  // Doble clic en la carátula: play o pausa, como tocarla en el móvil.
  mini.addEventListener("dblclick", (event) => {
    if (!event.target.closest("button, input")) now.actions.toggle();
  });

  scrub.addEventListener("pointerdown", () => (scrubbing = true));
  scrub.addEventListener("input", () => {
    scrub.style.setProperty("--played", `${Number(scrub.value) / 10}%`);
  });
  scrub.addEventListener("change", () => {
    scrubbing = false;
    now.actions.seek(Number(scrub.value) / SCRUB_STEPS);
  });

  const vol = $("mini-vol");
  vol.addEventListener("input", () => {
    now.actions.setVolume(Number(vol.value) / 100);
    showVolume(true);
  });

  // La rueda en cualquier sitio del mini sube o baja el volumen, y lo enseña.
  mini.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep") / 100;
      now.actions.setVolume(Number(vol.value) / 100 + (event.deltaY < 0 ? step : -step));
      showVolume(true);
    },
    { passive: false },
  );

  // Al salir el ratón, los controles se esconden y el volumen también.
  mini.addEventListener("mouseleave", () => showVolume(false));

  bindDrag();
  now.onChange(render);
  now.onTime(renderTime);
  renderTime(now.position());
  onLyricLine(renderLine);
}
