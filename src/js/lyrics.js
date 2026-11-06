import { runtime } from "./platform.js";
// Muestra las letras obtenidas de lrclib por Rust.
// En letras sincronizadas, resalta el verso actual y permite saltar a él.

import { els } from "./dom.js";
import * as prefs from "./prefs.js";
import { prepareLyrics, lyricIndex } from './lyrics-policy.js';
import { lyricsScroll } from './motion.js';

const { invoke } = runtime.core;

/** Lo que mueven los botones de sincronía de debajo de la letra. */
const OFFSET_STEP = 0.5;

/**
 * Desfase de la letra en segundos (Ajustes › Reproducción): positivo la
 * adelanta, para cuando va detrás de la voz.
 */
let offset = 0;
let lastTime = 0;

/** Id de la pista cuya letra está puesta, para descartar respuestas tardías. */
let request = 0;
let lines = [];
let activeIndex = -1;

/** La lectura manual termina cuando el usuario pide volver al verso actual. */
let manual = false;
const follow = () => document.getElementById('lyrics-follow');
function renderFollow() { follow().hidden = !manual || !lines.length; }
function centerActive(instant = false) {
  if (manual || els.lyrics.hidden || !els.lyrics.clientHeight || activeIndex < 0) return;
  const node = els.lyrics.querySelector(`.lyric[data-index="${activeIndex}"]`);
  if (!node) return;
  const target = Math.max(0, node.offsetTop - els.lyrics.clientHeight / 2 + node.clientHeight / 2);
  const behavior = instant ? 'auto' : lyricsScroll(target - els.lyrics.scrollTop, els.lyrics.clientHeight);
  els.lyrics.scrollTo({ top: target, behavior });
}

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
  renderFollow();
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
    button.addEventListener("click", () => { manual = false; renderFollow(); onSeek(line.time); });
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
  const mine = ++request;
  lines = [];
  activeIndex = -1;
  lastTime = 0;
  manual = false;
  els.lyrics.scrollTo({top:0,behavior:'instant'});
  els.lyrics.removeAttribute('aria-busy');
  announceLine(-1);

  if (!track?.id || !track.title) {
    message("Aquí verás la letra de lo que suena.");
    return;
  }

  message("Buscando la letra...");
  els.lyrics.setAttribute('aria-busy', 'true');

  try {
    const lyrics = await invoke("get_lyrics", {
      id: track.id,
      title: track.title,
      uploader: track.uploader ?? null,
      duration: track.duration ?? null,
    });

    if (request !== mine) return;
    els.lyrics.removeAttribute('aria-busy');

    if (!lyrics) {
      message("No encontré la letra de esta canción.");
    } else if (lyrics.instrumental) {
      message("Instrumental.");
    } else if (prepareLyrics(lyrics.synced).length > 0) {
      lines = prepareLyrics(lyrics.synced);
      renderSynced(lines, lyrics.matched);
      tick(lastTime);
    } else if (lyrics.plain) {
      renderPlain(lyrics.plain, lyrics.matched);
    } else {
      message("No encontré la letra de esta canción.");
    }
  } catch (error) {
    if (request !== mine) return;
    els.lyrics.removeAttribute('aria-busy');
    console.warn("Letra:", error);
    message("No se pudo buscar la letra ahora mismo.");
  }
}

/** El último verso que ya ha empezado, por búsqueda binaria. */
/** Se llama con cada `timeupdate`: resalta el verso que suena. */
export function tick(time) {
  if (!Number.isFinite(time)) return;
  lastTime = time;
  if (document.hidden || lines.length === 0) return;

  const index = lyricIndex(lines, time, offset);
  if (index === activeIndex) return;

  const previous = els.lyrics.querySelector('.lyric.is-active');
  previous?.classList.remove('is-active');
  previous?.removeAttribute('aria-current');
  activeIndex = index;
  announceLine(index);
  if (index < 0) return;

  const node = els.lyrics.querySelector(`.lyric[data-index="${index}"]`);
  node?.classList.add("is-active");
  node?.setAttribute('aria-current', 'true');
  centerActive();
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

  const pause = () => { if (lines.length) { manual = true; renderFollow(); els.lyrics.scrollTo({top:els.lyrics.scrollTop,behavior:'instant'}); } };
  document.getElementById('lyrics-resume').addEventListener('click', () => {
    manual = false; renderFollow();
    (els.lyrics.querySelector('.lyric.is-active') || els.lyrics).focus({preventScroll:true});
    centerActive();
  });
  // Rueda, arrastre y teclado dan prioridad a la lectura manual.
  for (const event of ["wheel", "touchmove", "pointerdown"]) {
    els.lyrics.addEventListener(
      event,
      pause,
      { passive: true },
    );
  }
  els.lyrics.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key) || (event.key === ' ' && event.target === els.lyrics)) {
      // Leer con el teclado no debe disparar también volumen o reproducción.
      event.stopPropagation(); pause();
    }
  });
  // Al mostrar la pestaña o expandir la ventana, recolocar sin animar el layout.
  new ResizeObserver(() => centerActive(true)).observe(els.lyrics);
  const stopSmooth = () => els.lyrics.scrollTo({top:els.lyrics.scrollTop,behavior:'instant'});
  new MutationObserver(stopSmooth).observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', stopSmooth);
}
