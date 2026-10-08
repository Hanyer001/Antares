// Adaptador de ExoPlayer para la interfaz de <audio> usada por player.js.
// Envía órdenes al plugin player y traduce sus eventos. PlaybackService.kt
// mantiene la reproducción de Android con la pantalla apagada.

const { invoke, addPluginListener } = window.__TAURI__.core;

export const nativeCall = (command, args = {}) =>
  invoke(`plugin:player|${command}`, args).catch((error) => {
    console.warn(`Reproductor nativo (${command}):`, error);
    throw error;
  });

const call = nativeCall;

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
   *   plato" de player.js; Android gestiona los fundidos en el servicio nativo.
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
    this._generation = 0;
    this._transportSerial = 0;
    this._transportIntent = null;
    this._lastStateSequence = -1;
    this._nativeState = null;
    this._nativePlaying = false;
  }

  // --- Lo que lee player.js ---------------------------------------------

  getAttribute(name) {
    return name === "src" && this._src ? this._src : null;
  }

  removeAttribute(name) {
    if (name !== "src" || !this._src) return;
    this._src = "";
    this._reset();
    ++this._generation;
    if (!this.inert) this._pending = this._pending.catch(() => {}).then(() => call("stop"));
    this._pending.catch(() => {});
  }

  get src() {
    return this._src;
  }

  set src(url) {
    this._src = url;
    this._reset();
    if (this.inert) return;
    const generation = ++this._generation;
    const args = { url, ...this._meta, startAt: 0, play: false };
    this._pending = this._pending.catch(() => {}).then(() => {
      if (generation === this._generation) return call("load", args);
    });
    this._pending.catch(() => {
      if (generation !== this._generation) return;
      this.error = { message: "load" };
      this._fire("error");
    });
  }

  /** Título, artista y carátula para la notificación. Antes de `src`. */
  setMetadata({ id, title, artist, artwork, duration } = {}) {
    this._meta = { id, duration, title: title ?? null, artist: artist ?? null, artwork: artwork ?? null };
  }

  load() {}
  adopt(track) {
    if (this._meta.id !== track.id) {
      ++this._generation; ++this._transportSerial;
      this._transportIntent = null; this._nativeState = null; this._nativePlaying = false;
      this._time = 0; this._buffered = 0;
    }
    this._src = `antares://video/${track.id}`;
    this.setMetadata({id:track.id,title:track.title,artist:track.uploader,artwork:track.thumbnail,duration:track.duration});
    this._metadataSent = false;
    this.ended = false;
    this.error = null;
    this._duration = track.duration > 0 ? track.duration : Number.NaN;
  }
  syncQueue(payload) {
    const generation = this._generation;
    return this._pending.then(() => {
      if (generation === this._generation && payload.currentId === this._meta.id) return call("syncQueue",payload);
    });
  }

  get currentTime() {
    return this._time;
  }

  set currentTime(seconds) {
    this._time = seconds;
    if (!this.inert && this._src) {
      const generation = this._generation;
      this._pending = this._pending.then(() => {
        if (generation === this._generation) return call("seek", { seconds });
      });
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
    return this._transport(true);
  }

  /** La orden play puede confirmarse mientras Media3 todavía está cargando. */
  waitUntilPlaying(timeout = 90000) {
    if (this._nativePlaying && !this.paused) return Promise.resolve();
    if (this.error) return Promise.reject(new Error(this.error.message));
    if (this.paused || !this._src) return Promise.reject(new Error("Reproducción cancelada"));
    return new Promise((resolve, reject) => {
      let deadline;
      const clear = () => {
        clearTimeout(deadline);
        for (const type of ["playing", "error", "pause", "emptied"]) this.removeEventListener(type, finish);
      };
      const finish = event => {
        clear();
        if (event.type === "playing") resolve();
        else reject(new Error(event.type === "error" ? this.error?.message || "Error de audio" : "Reproducción cancelada"));
      };
      for (const type of ["playing", "error", "pause", "emptied"]) this.addEventListener(type, finish);
      deadline = setTimeout(() => { clear(); reject(new Error("Se agotó el tiempo de carga del audio")); }, timeout);
    });
  }

  pause() {
    if (this.inert || !this._src) return;
    this._transport(false).catch(() => {});
  }

  _setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this._fire(paused ? "pause" : "play");
  }

  /** Respuesta inmediata al toque; la confirmación de Media3 decide el estado final. */
  _transport(ready) {
    const generation = this._generation;
    const serial = ++this._transportSerial;
    const previousPaused = this.paused;
    this._transportIntent = { serial, ready };
    this.ended = false;
    this._setPaused(!ready);
    if (ready && !this._nativePlaying) this._fire("waiting");
    return this._pending.then(() => {
      if (generation !== this._generation || serial !== this._transportSerial) return;
      return call(ready ? "play" : "pause");
    }).then(state => {
      if (generation !== this._generation || serial !== this._transportSerial) return;
      this._transportIntent = null;
      if (state?.id) this._onState(state);
    }).catch(error => {
      if (generation === this._generation && serial === this._transportSerial) {
        this._transportIntent = null;
        this._setPaused(this._nativeState ? !this._nativeState.playWhenReady : previousPaused);
      }
      throw error;
    });
  }

  // --- Lo que llega del plugin ------------------------------------------

  _reset() {
    this._fire("emptied");
    this._time = 0;
    this._duration = Number.NaN;
    this._buffered = 0;
    this.ended = false;
    this.paused = true;
    this.error = null;
    this._metadataSent = false;
    ++this._transportSerial;
    this._transportIntent = null;
    this._nativeState = null;
    this._nativePlaying = false;
  }

  _fire(type) {
    this.dispatchEvent(new Event(type));
  }

  _onTime({ id, position, duration, buffered }) {
    if (!this._src || id !== this._meta.id) return;
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

  _onState({ id, playing, playWhenReady, buffering, ended, sequence }) {
    if (!this._src || id !== this._meta.id) return;
    if (Number.isFinite(sequence)) {
      if (sequence <= this._lastStateSequence) return;
      this._lastStateSequence = sequence;
    }
    // Compatibilidad con eventos de prueba anteriores. Android siempre envía playWhenReady.
    const ready = typeof playWhenReady === "boolean" ? playWhenReady : Boolean(playing || (buffering && !this.paused));
    this._nativeState = { playWhenReady: ready };
    if (this._transportIntent && ready !== this._transportIntent.ready) return;
    if (ended && !this.ended) {
      this.ended = true; this.paused = true; this._nativePlaying = false;
      this._fire("ended");
      return;
    }
    // «Pausa» es la intención; «playing» indica que salen muestras del decodificador.
    this._setPaused(!ready);
    if (buffering && ready) this._fire("waiting");
    const wasPlaying = this._nativePlaying;
    this._nativePlaying = Boolean(playing);
    if (playing && !wasPlaying) this._fire("playing");
  }

  _onError({ id, message }) {
    if (!this._src || id !== this._meta.id) return;
    this.error = { message };
    this._fire("error");
  }
}

/**
 * Conecta los eventos del plugin con el plato que suena, y las órdenes de la
 * notificación ("siguiente", "anterior") con `onCommand`.
 */
export async function connectNative(deck, { onItem, onSleep }) {
  await Promise.all([
    addPluginListener("player", "time", (data) => deck._onTime(data)),
    addPluginListener("player", "state", (data) => deck._onState(data)),
    addPluginListener("player", "error", (data) => deck._onError(data)),
    addPluginListener("player", "item", onItem),
    addPluginListener("player", "sleep", onSleep),
  ]);
}

/** "Atrás" en la pantalla principal: la app pasa al fondo sin cerrarse. */
export function sendToBackground() {
  return call("background").catch(() => {});
}
