// Atajos locales y globales definidos en las preferencias.
// Rust registra los globales y emite shortcut; main.js asigna las acciones.

import { comboFromEvent } from "./keys.js";
import * as prefs from "./prefs.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** Acciones que funcionan aunque el foco esté en un campo de texto. */
const EVEN_WHILE_TYPING = new Set(["fullscreen"]);

let actions = {};
let lastGlobal = "";
let failed = [];
const statusListeners = [];

/** Los atajos globales que Windows no dejó registrar (ya los usa otro programa). */
export function failedGlobal() {
  return failed;
}

/** Aviso cuando cambia qué atajos globales fallaron. */
export function onGlobalStatus(callback) {
  statusListeners.push(callback);
}

async function applyGlobal() {
  const { globalEnabled, global } = prefs.get("shortcuts");
  const bindings = globalEnabled ? global : {};

  const key = JSON.stringify(bindings);
  if (key === lastGlobal) return;
  lastGlobal = key;

  try {
    failed = await invoke("set_global_shortcuts", { bindings });
  } catch (error) {
    console.warn("No se pudieron registrar los atajos globales:", error);
    failed = Object.keys(bindings);
  }
  for (const listener of statusListeners) listener(failed);
}

function onKeyDown(event) {
  const combo = comboFromEvent(event);
  if (!combo) return;

  const local = prefs.get("shortcuts.local");
  const action = Object.keys(local).find((name) => local[name] === combo);
  if (!action || !actions[action]) return;

  const target = event.target;
  const typing = target.closest?.("input, textarea, select, dialog, .menu");
  if (typing && !EVEN_WHILE_TYPING.has(action)) return;

  // Espacio o Intro sobre una fila o tarjeta ya sirven para elegirla.
  if (combo === "Space" && target.closest?.(".result, .card, button")) return;

  event.preventDefault();
  actions[action]();
}

/**
 * @param {Record<string, Function>} handlers  una función por acción
 *   (`playPause`, `next`, `seekBack`...). Las mismas sirven para los globales.
 */
export function initShortcuts(handlers) {
  actions = handlers;
  document.addEventListener("keydown", onKeyDown);

  applyGlobal();
  prefs.on("shortcuts", applyGlobal);

  listen("shortcut", ({ payload }) => actions[payload]?.()).catch((error) =>
    console.warn("Sin atajos globales:", error),
  );
}
