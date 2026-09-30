// Aplica el diseño mediante atributos y variables CSS.
// Gestiona el tamaño de las columnas y los modos mini y escucha.

import { els } from "./dom.js";
import * as prefs from "./prefs.js";
import { SCHEMA } from "./prefs-schema.js";

const { invoke } = window.__TAURI__.core;

const root = document.documentElement;

/** Los botones de la consola que se pueden quitar, y la preferencia de cada uno. */
const CONSOLE_PARTS = {
  rate: "showRate",
  radio: "showRadio",
  sleep: "showSleep",
  modes: "showModes",
  volume: "showVolume",
};

let mini = false;
let focus = false;
const handlers = { change: () => {} };

// --- Aplicar -------------------------------------------------------------

function apply() {
  const layout = prefs.get("layout");

  root.dataset.sidebar = layout.sidebar;
  root.toggleAttribute("data-mirrored", layout.mirrored);
  root.dataset.artwork = layout.artwork;
  root.toggleAttribute("data-no-upnext", !layout.upnext);

  const hidden = Object.entries(CONSOLE_PARTS)
    .filter(([, pref]) => !layout[pref])
    .map(([part]) => part);
  root.dataset.consoleHide = hidden.join(" ");

  root.style.setProperty("--sidebar-pref", `${layout.sidebarWidth}px`);
  root.style.setProperty("--nowplaying-pref", `${layout.nowplayingWidth}px`);

  applyTabs(layout);
}

/** Orden y visibilidad de las pestañas: se mueven los botones de verdad. */
function applyTabs(layout) {
  const buttons = new Map(
    [...els.tabs.querySelectorAll(".tab[data-tab]")].map((b) => [b.dataset.tab, b]),
  );

  for (const id of layout.tabOrder) {
    const button = buttons.get(id);
    if (!button) continue;
    els.tabs.append(button);
    button.hidden = layout.hiddenTabs.includes(id);
    // Con la barra en solo iconos, el nombre va en el tooltip.
    button.title = button.textContent.trim();
  }
}

function applyLyrics() {
  const lyrics = prefs.get("lyrics");
  root.dataset.lyricsSize = lyrics.size;
  root.dataset.lyricsAlign = lyrics.align;
}

// --- Anchos arrastrando --------------------------------------------------

function limits(which) {
  const node = SCHEMA.layout[which === "sidebar" ? "sidebarWidth" : "nowplayingWidth"];
  return [node.min, node.max, node.def];
}

function bindResizer(handle) {
  const which = handle.dataset.resize;
  const pref = which === "sidebar" ? "layout.sidebarWidth" : "layout.nowplayingWidth";
  const cssVar = which === "sidebar" ? "--sidebar-pref" : "--nowplaying-pref";
  const [min, max, def] = limits(which);

  let dragging = false;
  let width = 0;

  // ¿La columna está pegada al borde izquierdo de la ventana? Entonces su
  // ancho es la x del puntero; si está a la derecha, lo que queda hasta el
  // borde derecho. El espejo cambia qué columna va a cada lado.
  const fromLeft = () => (which === "sidebar") !== root.hasAttribute("data-mirrored");

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    root.classList.add("is-resizing");
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const x = fromLeft() ? event.clientX : window.innerWidth - event.clientX;
    width = Math.round(Math.min(Math.max(x, min), max));
    root.style.setProperty(cssVar, `${width}px`);
  });

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove("is-resizing");
    // Se guarda al soltar: mientras se arrastra, solo cambia la variable.
    if (width) prefs.set(pref, width);
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);

  handle.addEventListener("dblclick", () => prefs.set(pref, def));

  // Con el teclado: flechas de 16 en 16.
  handle.tabIndex = 0;
  handle.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
    if (!step) return;
    event.preventDefault();
    const grow = fromLeft() ? step : -step;
    prefs.set(pref, prefs.get(pref) + grow);
  });
}

// --- Modos mini y escucha ------------------------------------------------

export function isMini() {
  return mini;
}

export function isFocus() {
  return focus;
}

/**
 * El tamaño de la ventana del mini reproductor según su estilo, en píxeles al
 * 100 %: cuadrada con la carátula completa (como Apple Music), o una tira.
 */
export function miniWindowSize() {
  const { miniStyle, miniSize } = prefs.get("player");
  if (miniStyle === "compact") {
    return { small: [330, 88], medium: [390, 96], large: [470, 108] }[miniSize];
  }
  const side = { small: 280, medium: 340, large: 420 }[miniSize];
  return [side, side];
}

function applyMiniWindow() {
  const [width, height] = miniWindowSize();
  return invoke("set_mini_mode", { enabled: true, onTop: prefs.get("layout.miniOnTop"), width, height });
}

/** Modo mini: la ventana se hace pequeña y solo queda el mini reproductor. */
export async function setMini(enabled) {
  if (enabled === mini) return;
  if (enabled && focus) setFocus(false);

  mini = enabled;
  root.toggleAttribute("data-mini", mini);

  try {
    if (enabled) await applyMiniWindow();
    else await invoke("set_mini_mode", { enabled: false, onTop: false });
  } catch (error) {
    console.warn("No se pudo cambiar al modo mini:", error);
    mini = !enabled;
    root.toggleAttribute("data-mini", mini);
  }
  handlers.change();
}

/**
 * Modo escucha: la columna de lo que suena ocupa toda la ventana, con la
 * carátula en grande y la letra al lado.
 */
export function setFocus(enabled) {
  if (enabled === focus) return;
  if (enabled && mini) return;

  focus = enabled;
  root.toggleAttribute("data-focus", focus);
  els.focusButton.setAttribute("aria-pressed", String(focus));
  handlers.change();
}

/** Aviso al entrar o salir de un modo (main.js ajusta la letra, etc.). */
export function onModeChange(callback) {
  handlers.change = callback;
}

// --- Arranque ------------------------------------------------------------

export function initLayout() {
  apply();
  applyLyrics();
  prefs.on("layout", apply);
  prefs.on("lyrics", applyLyrics);

  for (const handle of document.querySelectorAll(".resizer")) bindResizer(handle);

  els.focusButton.addEventListener("click", () => setFocus(!focus));
  els.miniButton.addEventListener("click", () => setMini(true));
  els.modeExit.addEventListener("click", () => {
    if (mini) setMini(false);
    else setFocus(false);
  });
  els.resetWidths.addEventListener("click", () => {
    prefs.set("layout.sidebarWidth", limits("sidebar")[2]);
    prefs.set("layout.nowplayingWidth", limits("nowplaying")[2]);
  });
  els.tryMini.addEventListener("click", () => setMini(true));

  // Cambiar "encima de todo", el estilo o el tamaño con el mini ya puesto se
  // aplica al momento.
  prefs.on("layout.miniOnTop", () => {
    if (mini) applyMiniWindow().catch(() => {});
  });
  let lastSize = miniWindowSize().join("x");
  prefs.on("player", () => {
    const size = miniWindowSize().join("x");
    if (size === lastSize) return;
    lastSize = size;
    if (mini) applyMiniWindow().catch(() => {});
  });
}
