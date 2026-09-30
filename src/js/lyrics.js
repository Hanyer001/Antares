// Muestra las letras obtenidas de lrclib por Rust.
// En letras sincronizadas, resalta el verso actual y permite saltar a él.

import { els } from "./dom.js";
import * as prefs from "./prefs.js";

const { invoke } = window.__TAURI__.core;

/** Lo que mueven los botones de sincronía de debajo de la letra. */
const OFFSET_STEP = 0.5;

/**
 * Desfase de la letra en segundos (Ajustes › Reproducción): positivo la
 * adelanta, para cuando va detrás de la voz.
 */
let offset = 0;
let lastTime = 0;

/** Id de la pista cuya letra está puesta, para descartar respuestas tardías. */
let currentId = null;
let lines = [];
let activeIndex = -1;

/** Tras un scroll a mano, la lista deja de seguir al verso un rato. */
const MANUAL_SCROLL_PAUSE_MS = 4000;
let manualScrollUntil = 0;

let onSeek = () => {};

/** Quien quiere saber qué verso suena (el mini reproductor). */
const lineListeners = [];

/**
 * @param {(line: {text: string, next: string} | null) => void} callback
 *   Con el verso que suena y el siguiente; null sin letra sincronizada.
 */
export function onLine(callback) {
  lineListeners.push(callback);
}

function announceLine(index) {
  const line = index >= 0 && lines[index] ? { text: lines[index].text, next: lines[index + 1]?.text ?? "" } : null;
  for (const listener of lineListeners) listener(line);
}

function message(text) {
  const p = document.createElement("p");
  p.className = "lyrics__message";
  p.textContent = text;
  els.lyrics.replaceChildren(p);
  els.lyricsSync.hidden = true;
}

/** "+0,5 s", "−1 s", "0 s". */
export function formatOffset(seconds) {
  if (seconds === 0) return "0 s";
  const sign = seconds > 0 ? "+" : "−";
  return `${sign}${String(Math.abs(seconds)).replace(".", ",")} s`;
}

function renderOffset() {
  els.lyricsOffset.textContent = formatOffset(offset);
  els.lyricsOffsetSetting.textContent =
    offset === 0 ? "Sin ajustar" : `${formatOffset(offset)} ${offset > 0 ? "(adelantada)" : "(retrasada)"}`;
}

function renderSynced(synced, matched) {
  const nodes = synced.map((line, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lyric" + (line.text ? "" : " lyric--pause");
    button.textContent = line.text || "♪";
    button.dataset.index = String(i);
    button.addEventListener("click", () => onSeek(line.time));
    return button;
  });

  els.lyrics.replaceChildren(...nodes, credit(matched));
  // Ajustar la sincronía solo tiene sentido con letra sincronizada.
  els.lyricsSync.hidden = false;
}

function renderPlain(plain, matched) {
  const p = document.createElement("p");
  p.className = "lyrics__plain";
  p.textContent = plain;
  els.lyrics.replaceChildren(p, credit(matched));
}

/** De dónde sale la letra: así se ve si lrclib acertó con la canción. */
function credit(matched) {
  const p = document.createElement("p");
  p.className = "lyrics__credit";
  p.textContent = matched ? `${matched} · lrclib.net` : "lrclib.net";
  return p;
}

/** Busca y pinta la letra de una pista. */
export async function load(track) {
  currentId = track?.id ?? null;
  lines = [];
  activeIndex = -1;
  announceLine(-1);

  if (!track?.id || !track.title) {
    message("Aquí verás la letra de lo que suena.");
    return;
  }

  message("Buscando la letra...");
  const mine = track.id;

  try {
    const lyrics = await invoke("get_lyrics", {
      id: track.id,
      title: track.title,
      uploader: track.uploader ?? null,
      duration: track.duration ?? null,
    });

    if (currentId !== mine) return;

    if (!lyrics) {
      message("No encontré la letra de esta canción.");
    } else if (lyrics.instrumental) {
      message("Instrumental.");
    } else if (lyrics.synced.length > 0) {
      lines = lyrics.synced;
      renderSynced(lines, lyrics.matched);
    } else if (lyrics.plain) {
      renderPlain(lyrics.plain, lyrics.matched);
    } else {
      message("No encontré la letra de esta canción.");
    }
  } catch (error) {
    if (currentId !== mine) return;
    console.warn("Letra:", error);
    message("No se pudo buscar la letra ahora mismo.");
  }
}

/** El último verso que ya ha empezado, por búsqueda binaria. */
function lineAt(time) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + 0.15) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

/** Se llama con cada `timeupdate`: resalta el verso que suena. */
export function tick(time) {
  lastTime = time;
  if (lines.length === 0) return;

  const index = lineAt(time + offset);
  if (index === activeIndex) return;

  els.lyrics.querySelector(".lyric.is-active")?.classList.remove("is-active");
  activeIndex = index;
  announceLine(index);
  if (index < 0) return;

  const node = els.lyrics.querySelector(`.lyric[data-index="${index}"]`);
  node?.classList.add("is-active");

  // Solo si la letra está a la vista y el usuario no está leyendo por su cuenta.
  if (node && !els.lyrics.hidden && performance.now() > manualScrollUntil) {
    const box = els.lyrics;
    const target = node.offsetTop - box.clientHeight / 2 + node.clientHeight / 2;
    box.scrollTo({ top: target, behavior: "smooth" });
  }
}

export function initLyrics({ seek }) {
  // Un clic en un verso salta a él: con desfase, a donde de verdad suena.
  onSeek = (time) => seek(Math.max(time - offset, 0));
  message("Aquí verás la letra de lo que suena.");

  offset = prefs.get("lyrics.offset");
  renderOffset();
  prefs.on("lyrics.offset", (value) => {
    offset = value;
    renderOffset();
    activeIndex = -2; // fuerza a repintar el verso activo
    tick(lastTime);
  });

  const nudge = (delta) =>
    prefs.set("lyrics.offset", Math.round((offset + delta) / OFFSET_STEP) * OFFSET_STEP);
  els.lyricsEarlier.addEventListener("click", () => nudge(OFFSET_STEP));
  els.lyricsLater.addEventListener("click", () => nudge(-OFFSET_STEP));

  // La rueda o el arrastre del usuario pausan el seguimiento automático.
  for (const event of ["wheel", "touchmove", "pointerdown"]) {
    els.lyrics.addEventListener(
      event,
      () => {
        manualScrollUntil = performance.now() + MANUAL_SCROLL_PAUSE_MS;
      },
      { passive: true },
    );
  }
}
