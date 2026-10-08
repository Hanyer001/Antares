// Estado de recomendaciones de la sesión: aventura, reproducción automática
// y semillas descartadas. Dos saltos del mismo Mix reducen su peso en la sesión.

import * as moments from "./moments.js";
import { els } from "./dom.js";
import * as library from "./library.js";
import { tuningFrom } from "./filters.js";
import * as prefs from "./prefs.js";

/** Saltos del Mix de una misma semilla para darla por mala en la sesión. */
const SKIPS_TO_AVOID = 2;

let adventure = 0.3;
let autoplay = true;

const played = new Set();
const seedSkips = new Map();

/**
 * Lo último que el usuario eligió a mano (buscó y puso, o añadió a la cola),
 * más reciente primero. Son las semillas de lo que la cola recomienda detrás:
 * "recomendaciones de lo que busco".
 */
const MAX_PICKS = 3;
let picks = [];

// --- Preferencias --------------------------------------------------------

function load() {
  ({ adventure, autoplay } = prefs.get("discovery"));
}

function render() {
  const percent = Math.round(adventure * 100);
  els.adventure.value = String(percent);
  els.adventure.style.setProperty("--level", `${percent}%`);
  els.adventureValue.textContent = `${percent} %`;
  els.autoplay.checked = autoplay;
}

export function initDiscovery() {
  load();
  render();

  prefs.on("discovery", () => {
    load();
    render();
  });

  els.adventure.addEventListener("input", () => {
    prefs.set("discovery.adventure", Number(els.adventure.value) / 100);
  });

  els.autoplay.addEventListener("change", () => {
    prefs.set("discovery.autoplay", els.autoplay.checked);
  });
}

export function autoplayEnabled() {
  return autoplay;
}

// --- Sesión --------------------------------------------------------------

/**
 * Apunta cómo acabó una escucha. `track.seed` viene en las pistas que salieron
 * de una recomendación: es lo que permite culpar al Mix correcto.
 */
export function noteListen(track, outcome) {
  if (!track?.id) return;
  played.add(track.id);

  if (!track.seed) return;

  if (outcome === "skip") {
    seedSkips.set(track.seed, (seedSkips.get(track.seed) ?? 0) + 1);
  } else if (outcome === "complete") {
    // Una escucha entera perdona: la racha de saltos era casualidad.
    seedSkips.delete(track.seed);
  }
}

/** Apunta una elección del usuario como semilla de las recomendaciones. */
export function notePick(track) {
  if (!track?.id) return;
  moments.notePick(track);
  picks = [track, ...picks.filter((t) => t.id !== track.id)].slice(0, MAX_PICKS);
}

/** Las elecciones recientes, para guardarlas con la sesión. */
export function getPicks() {
  return picks;
}

export function setPicks(saved) {
  if (Array.isArray(saved)) picks = saved.filter((t) => t?.id).slice(0, MAX_PICKS);
}

/**
 * Las semillas de la cola: lo que eligió el usuario, y si aún no eligió nada,
 * lo que suena.
 */
export function seedsFor(playing) {
  if (moments.seeds().length > 0) return moments.seeds();
  if (picks.length > 0) return picks;
  return playing?.id ? [playing] : [];
}

function avoidedSeeds() {
  return [...seedSkips].filter(([, skips]) => skips >= SKIPS_TO_AVOID).map(([seed]) => seed);
}

/**
 * Pide recomendaciones con el estado de la sesión ya puesto.
 *
 * @param {"mix"|"radio"} mode
 * @param {object} opts
 * @param {object[]} [opts.seeds]   Canciones de partida, más recientes primero.
 * @param {number}   opts.count
 * @param {string[]} [opts.exclude] Además de lo ya sonado (la cola, típicamente).
 */
export function request(mode, { seeds = [], count, exclude = [] }) {
  const preferred = moments.seeds();
  if (mode === "mix" && preferred.length) { seeds = preferred; if (moments.contextual()) mode = "radio"; }
  return library.recommend({
    mode,
    seeds,
    count,
    adventure,
    exclude: [...new Set([...played, ...exclude, ...moments.exclusions(), ...prefs.get("discovery.knownTracks")])],
    avoidSeeds: avoidedSeeds(),
    tuning: tuningFrom(prefs.get("discovery")),
  }).then(tracks => tracks.filter(t => moments.allowed(t) && !prefs.get("discovery.knownTracks").includes(t.id)));
}
