// Adaptador de ExoPlayer para la interfaz de <audio> usada por player.js.
// Envía órdenes al plugin player y traduce sus eventos. PlaybackService.kt
// mantiene la reproducción de Android con la pantalla apagada.

const { invoke, addPluginListener } = window.__TAURI__.core;

const call = (command, args = {}) =>
  invoke(`plugin:player|${command}`, args).catch((error) => {
    console.warn(`Reproductor nativo (${command}):`, error);
    throw error;
  });

/** Un TimeRanges de un solo tramo, que es lo que lee player.js. */
function ranges(end) {
  return {
    length: end > 0 ? 1 : 0,
    start: () => 0,
    end: () => end,
  };
}

export class NativeDeck extends EventTarget {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.inert]  Un plato que no suena nunca: el "segundo
   *   plato" de player.js, que en Android no hace falta (no hay fundidos).
   */
  constructor({ inert = false } = {}) {
    super();
    this.inert = inert;
    this.crossOrigin = null;
    this.error = null;
    this.paused = true;
    this.ended = false;
    this._src = "";
    this._time = 0;
    this._duration = Number.NaN;
    this._buffered = 0;
    this._volume = 1;
    this._meta = {};
    this._metadataSent = false;
    this._pending = Promise.resolve();
  }

  // --- Lo que lee player.js ---------------------------------------------

  getAttribute(name) {
    return name === "src" && this._src ? this._src : null;
  }

  removeAttribute(name) {
    if (name !== "src" || !this._src) return;
    this._src = "";
    this._reset();
    if (!this.inert) call("stop").catch(() => {});
  }

  get src() {
    return this._src;
  }

  set src(url) {
    this._src = url;
    this._reset();
    if (this.inert) return;
    this._pending = call("load", { url, ...this._meta, startAt: 0, play: false });
    this._pending.catch(() => {
      this.error = { message: "load" };
      this._fire("error");
    });
  }

  /** Título, artista y carátula para la notificación. Antes de `src`. */
  setMetadata({ title, artist, artwork } = {}) {
    this._meta = { title: title ?? null, artist: artist ?? null, artwork: artwork ?? null };
  }

  load() {}

  get currentTime() {
    return this._time;
  }

  set currentTime(seconds) {
    this._time = seconds;
    if (!this.inert && this._src) {
      this._pending = this._pending.then(() => call("seek", { seconds }));
      this._pending.catch(() => {});
    }
  }

  get duration() {
    return this._duration;
  }

  get buffered() {
    return ranges(this._buffered);
  }

  get volume() {
    return this._volume;
  }

  set volume(value) {
    this._volume = value;
    if (!this.inert) call("setVolume", { volume: value }).catch(() => {});
  }

  play() {
    if (this.inert || !this._src) return Promise.resolve();
    this.ended = false;
    return this._pending.then(() => call("play")).then(() => {});
  }

  pause() {
    if (this.inert || !this._src) return;
    call("pause").catch(() => {});
  }

  // --- Lo que llega del plugin ------------------------------------------

  _reset() {
    this._time = 0;
    this._duration = Number.NaN;
    this._buffered = 0;
    this.ended = false;
    this.paused = true;
    this.error = null;
    this._metadataSent = false;
  }

  _fire(type) {
    this.dispatchEvent(new Event(type));
  }

  _onTime({ position, duration, buffered }) {
    if (!this._src) return;
    this._time = position;
    this._buffered = buffered;
    if (duration > 0) {
      this._duration = duration;
      if (!this._metadataSent) {
        this._metadataSent = true;
        this._fire("loadedmetadata");
      }
    }
    this._fire("timeupdate");
    this._fire("progress");
  }

  _onState({ playing, buffering, ended }) {
    if (!this._src) return;

    if (ended && !this.ended) {
      this.ended = true;
      this.paused = true;
      this._fire("ended");
      return;
    }
    if (buffering && !this.paused) this._fire("waiting");

    if (playing && this.paused) {
      this.paused = false;
      this._fire("play");
      this._fire("playing");
    } else if (!playing && !buffering && !this.paused) {
      this.paused = true;
      this._fire("pause");
    }
  }

  _onError({ message }) {
    if (!this._src) return;
    this.error = { message };
    this._fire("error");
  }
}

/**
 * Conecta los eventos del plugin con el plato que suena, y las órdenes de la
 * notificación ("siguiente", "anterior") con `onCommand`.
 */
export async function connectNative(deck, { onCommand }) {
  await Promise.all([
    addPluginListener("player", "time", (data) => deck._onTime(data)),
    addPluginListener("player", "state", (data) => deck._onState(data)),
    addPluginListener("player", "error", (data) => deck._onError(data)),
    addPluginListener("player", "command", ({ action }) => onCommand(action)),
  ]);
}

/** "Atrás" en la pantalla principal: la app pasa al fondo sin cerrarse. */
export function sendToBackground() {
  return call("background").catch(() => {});
}
