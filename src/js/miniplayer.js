import { runtime } from "./platform.js";
// Reproductor en ventana pequeña, con vista de carátula o compacta.
// Comparte estado y controles con la consola a través de nowstate.js.
// La ventana se puede arrastrar desde las zonas sin controles.

import { PlayerView, volume_action } from "./rust-core.js";
import * as now from "./nowstate.js";
import * as prefs from "./prefs.js";

/** Sin tocar nada, el volumen vuelve a ser los controles. */
const VOLUME_IDLE_MS = 3500;

const root = document.documentElement;
const $ = (id) => document.getElementById(id);

let mini;
let scrub;
let view;
const identity = s => JSON.stringify([s.revision, s.title, s.artist]);
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
  if (view.render(JSON.stringify(s), identity(s))) renderTime(now.position());
}

function renderTime({ current, duration }) {
  if (!document.hidden && root.hasAttribute("data-mini")) view.update_time(current, duration ?? NaN);
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
  const { getCurrentWindow } = runtime.window;
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
  view = new PlayerView(mini, true);

  applyPrefs();
  prefs.on("player", applyPrefs);

  const { getCurrentWindow } = runtime.window;
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

  const currentTrack = () => identity(now.snapshot());
  scrub.addEventListener("pointerdown", () => view.begin(currentTrack()));
  scrub.addEventListener("input", () => view.input(currentTrack()));
  scrub.addEventListener("change", () => {
    const ratio = view.commit(currentTrack());
    if (ratio == null) renderTime(now.position());
    else now.actions.seek(ratio);
  });
  scrub.addEventListener("pointercancel", () => view.reset(true));
  scrub.addEventListener("blur", () => view.reset(false));
  scrub.addEventListener("keydown", event => {
    if (event.key === "Escape") { view.reset(true); return; }
    const ratio = view.seek_key(event.key);
    if (ratio == null) return;
    event.preventDefault();
    now.actions.seek(ratio);
  });

  const vol = $("mini-vol");
  vol.addEventListener("input", () => {
    now.actions.setVolume(volume_action(vol.valueAsNumber, 0));
    showVolume(true);
  });

  // La rueda en cualquier sitio del mini sube o baja el volumen, y lo enseña.
  mini.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep");
      now.actions.setVolume(volume_action(vol.valueAsNumber, event.deltaY < 0 ? step : -step));
      showVolume(true);
    },
    { passive: false },
  );

  // Al salir el ratón, los controles se esconden y el volumen también.
  mini.addEventListener("mouseleave", () => showVolume(false));

  bindDrag();
  now.onChange(render);
  now.onTime(renderTime);
  new MutationObserver(() => renderTime(now.position())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mini"] });
  renderTime(now.position());
  onLyricLine(renderLine);
}
