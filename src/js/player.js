// Controla los dos elementos de audio, el volumen y la posición.
// Durante un fundido, el audio entrante pasa a ser el activo. Solo los eventos
// del activo se propagan al resto de la app.

import { els } from "./dom.js";
import { WEB } from "./platform.js";
import { mediaDuration, passedCatalogEnd } from "./timeline.js";
import { visualTask } from "./visual-activity.js";
import { console_play, console_time, console_volume, format_clock } from "./rust-core.js";
import * as prefs from "./prefs.js";
import * as sound from "./sound.js";
import { gainFor } from "./volume.js";

/** Resolución del control de posición: 1000 pasos sobre la duración total. */
const SCRUB_STEPS = 1000;

let decks = [els.audio, els.audioB];
let active = decks[0];

/**
 * Cambia los platos: en Android, los nativos (native-deck.js) en vez de los
 * <audio> de la página. Antes de `initPlayer`.
 */
export function useDecks(a, b) {
  decks = [a, b];
  active = a;
  nativeDecks = true;
}

/**
 * En Android no hay deslizador (manda el volumen del teléfono): el nivel se
 * pasa tal cual, sin la curva de `gainFor`.
 */
let nativeDecks = false;

/** Volumen elegido por el usuario (0..1) y si está silenciado. */
let volume = 0.8;
let muted = false;

/** Mientras el usuario arrastra, `timeupdate` no debe mover la barra. */
let isScrubbing = false;

/** Temporizador que apaga el plato viejo al acabar una transición. */
let retireTimer = null;

/**
 * Duración recibida del proveedor para mostrarla antes de loadedmetadata.
 * Los saltos usan la duración del elemento de audio.
 */
let durationHint = null;
let pendingSeek = null;
let endEmitted = false;

function standby() {
  return active === decks[0] ? decks[1] : decks[0];
}

/** WebKit en macOS puede sobreestimar la duración después de un salto. */
function checksCatalogDuration() {
  return WEB || document.documentElement.dataset.platform === "macos";
}

function displayDuration() {
  return mediaDuration(active.duration, durationHint, checksCatalogDuration());
}

// --- Emisor mínimo -------------------------------------------------------
// Eventos: "play" | "pause" | "ended" | "waiting" | "playing" | "error"
//          | "time" (con la posición actual, en cada `timeupdate`)

const listeners = {};

export function on(event, callback) {
  (listeners[event] ||= []).push(callback);
}

function emit(event, ...args) {
  for (const callback of listeners[event] || []) callback(...args);
}

// --- Volumen y ganancias -------------------------------------------------

/** La ganancia que corresponde al deslizador ahora (0 si está silenciado). */
function outputGain() {
  if (muted) return 0;
  return nativeDecks ? volume : gainFor(volume);
}

/**
 * El volumen de salida. Con cadena de audio va en el volumen general; sin
 * ella, en cada <audio> (el plato en espera nunca está sonando a la vez salvo
 * en una transición, y entonces lo lleva `rampDeck`).
 */
function applyVolume() {
  const level = outputGain();
  if (sound.setMaster(level)) return;

  for (const deck of decks) deck.volume = deck === active ? level : 0;
}

/** Sube o baja un plato en `seconds`: transiciones y fundido del temporizador. */
function rampDeck(deck, to, seconds) {
  if (sound.rampDeck(deck, to, seconds)) return;

  // Sin cadena: a mano, sobre el volumen del <audio>.
  const from = deck.volume;
  const target = to * outputGain();
  const start = performance.now();

  const step = () => {
    const t = seconds > 0 ? Math.min((performance.now() - start) / (seconds * 1000), 1) : 1;
    deck.volume = from + (target - from) * t;
    if (t < 1) requestAnimationFrame(step);
  };
  step();
}

/** Deja un plato parado y vacío. */
function retire(deck) {
  deck.pause();
  deck.removeAttribute("src");
  deck.load();
}

// --- Pintado -------------------------------------------------------------

function renderPlayState() {
  console_play(els.play, els.iconPlay, els.iconPause, isPlaying(), nativeDecks);
}

const renderProgress = visualTask(() => {
  if (document.hidden) return;
  console_time(els.scrub, els.timeCurrent, els.timeTotal, active.currentTime,
    displayDuration() ?? NaN, isScrubbing, checksCatalogDuration());
});

/** Pinta por detrás cuánto lleva descargado el navegador. */
const renderBuffered = visualTask(() => {
  if (document.hidden) return;
  const { buffered, duration, currentTime } = active;
  if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) return;

  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
      const pct = (buffered.end(i) / duration) * 100;
      els.scrub.style.setProperty("--buffered", `${pct.toFixed(2)}%`);
      return;
    }
  }
});

function renderVolume() {
  console_volume(els.volume, els.volumeValue, els.mute, els.iconVol, els.iconMute, volume, muted);
}

function resetTimeline(knownDuration) {
  endEmitted = false;
  durationHint = Number.isFinite(knownDuration) && knownDuration > 0 ? knownDuration : null;

  els.scrub.value = "0";
  els.scrub.style.setProperty("--played", "0%");
  els.scrub.style.setProperty("--buffered", "0%");
  els.timeCurrent.textContent = "0:00";
  els.timeTotal.textContent = format_clock(durationHint ?? NaN);
}

/** El volumen se recuerda entre sesiones, con las demás preferencias. */
function saveVolume() {
  // Los dos a la vez: por separado, el aviso del primero releería el otro aún
  // sin actualizar.
  prefs.set("playback", { ...prefs.get("playback"), volume, muted });
}

function loadVolume() {
  volume = prefs.get("playback.volume");
  muted = prefs.get("playback.muted");
}

// --- API pública ---------------------------------------------------------

export function hasError() { return Boolean(active.error); }

export function isPlaying() {
  return !active.paused && !active.ended;
}

export function hasSource() {
  // `src` vacío resuelve a la URL de la página, así que se mira el atributo.
  return Boolean(active.getAttribute("src"));
}

export function bufferedAhead() {
  const position = active.currentTime;
  const ranges = active.buffered;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= position && ranges.end(i) >= position) return ranges.end(i) - position;
  }
  return 0;
}

export function currentTime() {
  return active.currentTime;
}

/** Duración real si ya se conoce; si no, la que dio el catálogo. */
export function duration() {
  return displayDuration();
}

/** Sube o baja el volumen (en 0..1). Subirlo también quita el silencio. */
export function nudgeVolume(delta) {
  volume = Math.min(Math.max(volume + delta, 0), 1);
  if (delta > 0) muted = false;
  applyVolume();
  renderVolume();
  saveVolume();
}

export function toggleMute() {
  muted = !muted;
  applyVolume();
  renderVolume();
  saveVolume();
}

/**
 * Carga una URL nueva en el plato activo y deja la barra en cero.
 *
 * @param {string} url
 * @param {number|null} knownDuration Duración en segundos según el catálogo, si la hay.
 * @param {number} [startAt] Segundo en el que empezar (al retomar una sesión).
 * @param {object} [meta] `{ title, artist, artwork }`: en Android van a la
 *   notificación y a la pantalla de bloqueo.
 */
export function load(url, knownDuration = null, startAt = 0, meta = null) {
  // Si había una transición a medias, se corta: lo nuevo manda.
  clearTimeout(retireTimer);
  retire(standby());

  resetTimeline(knownDuration);
  rampDeck(active, 1, 0);
  if (meta) active.setMetadata?.(meta);

  // Con preload="auto", asignar src ya arranca la descarga del búfer.
  pendingSeek = startAt > 0 ? { deck: active, time: startAt } : null;
  active.src = sound.sourceFor(url);
  if (nativeDecks && startAt > 0) active.currentTime = startAt;
}

/** Devuelve la promesa de `play()` para que quien llame gestione el rechazo. */
export function play() {
  sound.resume();
  return active.play();
}

/**
 * Funde la canción que suena con una nueva en `seconds` segundos.
 *
 * La nueva empieza en el plato en espera, a volumen cero, y sube mientras la
 * vieja baja. En cuanto empieza pasa a ser la activa: desde ese momento los
 * eventos, la barra y la posición son suyos. La vieja se apaga sola al acabar.
 */
export async function crossfadeTo(url, knownDuration, seconds) {
  const incoming = standby();
  const outgoing = active;

  clearTimeout(retireTimer);
  rampDeck(incoming, 0, 0);
  incoming.src = sound.sourceFor(url);

  sound.resume();
  try {
    await incoming.play();
  } catch (error) {
    // No arrancó: la vieja sigue sonando como si nada.
    retire(incoming);
    throw error;
  }

  active = incoming;
  resetTimeline(knownDuration);
  renderProgress();
  renderPlayState();

  rampDeck(incoming, 1, seconds);
  rampDeck(outgoing, 0, seconds);
  retireTimer = setTimeout(() => retire(outgoing), seconds * 1000 + 150);
}

/**
 * Baja el volumen hasta cero y pausa: el final del temporizador para dormir,
 * sin un corte en seco. Luego deja el volumen como estaba para la próxima vez.
 */
export function fadeOutAndPause(seconds) {
  const deck = active;
  rampDeck(deck, 0, seconds);

  setTimeout(() => {
    deck.pause();
    rampDeck(deck, 1, 0);
    applyVolume();
  }, seconds * 1000);
}

export function toggle() {
  if (!hasSource()) return;
  if (active.paused) { emit("intent", true); play().catch(() => emit("error")); }
  else { emit("intent", false); active.pause(); }
}

export function pause() {
  emit("intent", false);
  active.pause();
}

export function skip(seconds) {
  seek(active.currentTime + seconds);
}

export function seek(seconds) {
  const total = displayDuration();
  if (!Number.isFinite(seconds) || !Number.isFinite(total) || total <= 0) return;
  if (seconds < total) endEmitted = false;
  active.currentTime = Math.min(Math.max(seconds, 0), total);
}

/** Vuelve al principio y suena otra vez. Es "repetir esta canción". */
export function restart() {
  endEmitted = false;
  active.currentTime = 0;
  return play();
}

/** Cablea los controles con los <audio>. Se llama una sola vez, desde main.js. */
export function initPlayer() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { renderProgress(); renderBuffered(); }
  });
  for (const deck of decks) sound.attach(deck);

  loadVolume();
  applyVolume();
  renderVolume();
  renderPlayState();

  // Restablecer o importar ajustes también cambia el volumen.
  prefs.on("playback", () => {
    loadVolume();
    applyVolume();
    renderVolume();
  });

  // Play/pausa. Anterior y siguiente los cablea main.js, porque dependen de la
  // cola y el reproductor no sabe que existe.
  els.play.addEventListener("click", toggle);

  // Barra de posición. pointerdown/up marcan el arrastre; `input` mueve el audio
  // en vivo para que se oiga a dónde va mientras se arrastra.
  els.scrub.addEventListener("pointerdown", () => (isScrubbing = true));
  els.scrub.addEventListener("pointerup", () => (isScrubbing = false));
  els.scrub.addEventListener("pointercancel", () => { isScrubbing = false; renderProgress(); });
  els.scrub.addEventListener("blur", () => { isScrubbing = false; renderProgress(); });

  els.scrub.addEventListener("input", () => {
    const total = displayDuration();
    if (!Number.isFinite(total) || total <= 0) return;

    const ratio = Number(els.scrub.value) / SCRUB_STEPS;
    seek(ratio * total);
    els.scrub.style.setProperty("--played", `${(ratio * 100).toFixed(2)}%`);
  });

  // Volumen
  els.volume.addEventListener("input", () => {
    volume = Number(els.volume.value) / 100;
    muted = false;
    applyVolume();
    renderVolume();
    saveVolume();
  });

  // La rueda del ratón sobre el deslizador, con el paso de Ajustes (5 de
  // serie): el gesto natural en un escritorio, y más preciso que arrastrar un
  // control pequeño.
  els.volume.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const step = prefs.get("behavior.volumeStep") / 100;
      nudgeVolume(event.deltaY < 0 ? step : -step);
    },
    { passive: false },
  );

  els.mute.addEventListener("click", toggleMute);

  // Eventos de los <audio>: solo cuenta el plato activo. El otro, mientras se
  // apaga tras una transición, puede terminar o pausarse sin que eso signifique
  // nada para la app.
  const fromActive = (handler) => (event) => {
    if (event.target === active) handler(event);
  };

  const finishTrack = () => {
    if (endEmitted) return;
    endEmitted = true;
    renderPlayState();
    emit("ended");
  };

  for (const deck of decks) {
    deck.addEventListener("loadedmetadata", fromActive(() => {
      const total = displayDuration();
      if (pendingSeek?.deck === active && Number.isFinite(total)) {
        active.currentTime = Math.min(pendingSeek.time, Math.max(0, total - 0.1));
        pendingSeek = null;
      }
      renderProgress();
    }));
    deck.addEventListener("stalled", fromActive(() => emit("waiting")));
    deck.addEventListener(
      "timeupdate",
      fromActive(() => {
        renderProgress();
        const position = active.currentTime;
        const checkDuration = checksCatalogDuration();
        emit("time", checkDuration && durationHint ? Math.min(position, displayDuration()) : position);
        if (checkDuration && !endEmitted && !active.paused && !active.seeking && !isScrubbing
            && passedCatalogEnd(position, active.duration, durationHint)) {
          active.pause();
          finishTrack();
        }
      }),
    );
    deck.addEventListener("progress", fromActive(renderBuffered));

    deck.addEventListener(
      "play",
      fromActive(() => {
        renderPlayState();
        emit("play");
      }),
    );

    deck.addEventListener(
      "pause",
      fromActive(() => {
        renderPlayState();
        emit("pause");
      }),
    );

    deck.addEventListener("waiting", fromActive(() => emit("waiting")));

    deck.addEventListener(
      "playing",
      fromActive(() => {
        renderPlayState();
        emit("playing");
      }),
    );

    deck.addEventListener(
      "ended",
      fromActive(finishTrack),
    );

    // Salta si la URL caduca o si el servidor la rechaza. Con el cliente rápido
    // esto último puede pasar (403 sobre una URL válida en apariencia), pero
    // decidir qué hacer no es cosa del reproductor.
    deck.addEventListener(
      "error",
      fromActive(() => {
        if (hasSource()) emit("error");
      }),
    );
  }
}
