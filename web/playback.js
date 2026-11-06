import { Recovery } from "./shared/recovery.js";
import { formatTime } from "./shared/format.js";
import { icon } from "./shared/icons.js";
import * as media from "./shared/mediasession.js";

export function createPlayback({ audio, toggle, slider, elapsed, duration, diagnostics, audioUrl, onTrack, onEnd, onSave, status, showRetry }) {
  let track = null;
  let position = 0;
  let pendingSeek = null;
  let loading = false;
  let operation = 0;
  let lastSave = 0;
  let startedAt = performance.now();
  let scrubbing = false;

  function durationForUi() {
    const measured = audio.duration;
    const expected = track?.duration;
    const known = Number.isFinite(expected) && expected > 0;
    // Safari puede estimar una duración exagerada mientras lee el MP4 fragmentado.
    // El navegador conserva el control del fin real de la pista.
    if (known && (!Number.isFinite(measured) || measured <= 0 ||
      Math.abs(measured - expected) > Math.max(5, expected * 0.25))) return expected;
    return Number.isFinite(measured) && measured > 0 ? measured : 0;
  }

  function render() {
    const playing = loading || (!audio.paused && !audio.ended);
    const label = playing ? "Pausar" : "Reproducir";
    if (toggle.getAttribute("aria-label") !== label) {
      toggle.replaceChildren(icon(playing ? "pause" : "play"));
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
    const total = durationForUi();
    slider.disabled = !track || audio.readyState === 0 || total === 0;
    slider.max = String(total);
    if (!scrubbing) slider.value = String(Math.min(position, total));
    elapsed.textContent = formatTime(scrubbing ? Number(slider.value) : position);
    duration.textContent = total ? formatTime(total) : "—";
    slider.setAttribute("aria-valuetext", elapsed.textContent + " de " + duration.textContent);
  }

  function save() {
    lastSave = performance.now();
    onSave(track, position);
  }

  function load(next, time = 0) {
    track = next;
    position = Math.max(0, time);
    pendingSeek = position > 0 ? position : null;
    audio.src = audioUrl(next.id);
    startedAt = performance.now();
    media.setTrack(next);
    onTrack(next);
    render();
  }

  function blocked() {
    recovery.pause();
    loading = false;
    showRetry(false);
    status("Toca Reproducir para continuar.");
    render();
  }

  async function attempt() {
    const current = ++operation;
    loading = true;
    render();
    try {
      await audio.play();
      return current === operation;
    } catch (error) {
      if (current === operation && error.name === "NotAllowedError") blocked();
      return false;
    }
  }

  const recovery = new Recovery({
    timeout: 15000,
    async retry(time) {
      if (!track) return false;
      loading = true;
      status("Recuperando el audio…");
      load(track, time);
      return attempt();
    },
    waiting() {
      loading = false;
      showRetry(true);
      status("Sin conexión. Reintentaremos al recuperarla.");
      render();
    },
    failed() {
      ++operation;
      loading = false;
      audio.pause();
      showRetry(true);
      status("No se pudo cargar el audio.");
      render();
    },
  });

  function pause() {
    ++operation;
    recovery.pause();
    loading = false;
    audio.pause();
    showRetry(false);
    status("");
    render();
  }

  function start(next, { restart = false, reload = false } = {}) {
    if (!next) return;
    const same = track?.id === next.id;
    const time = same && !restart ? position : 0;
    loading = true;
    if (!same || audio.error || reload) load(next, time);
    else if (restart) {
      pendingSeek = null;
      position = 0;
      audio.currentTime = 0;
    }
    showRetry(false);
    status("Cargando audio…");
    recovery.begin(time);
    const current = operation + 1;
    attempt().then(ok => {
      if (!ok && current === operation && recovery.intent) recovery.fail();
    });
    save();
  }

  function seek(seconds) {
    if (!Number.isFinite(seconds) || !track || audio.readyState === 0) return;
    const total = durationForUi();
    audio.currentTime = total > 0 ? Math.max(0, Math.min(seconds, total)) : Math.max(0, seconds);
    position = audio.currentTime;
    recovery.progress(position);
    save();
    render();
  }

  slider.addEventListener("input", () => { scrubbing = true; render(); });
  slider.addEventListener("change", () => { scrubbing = false; seek(Number(slider.value)); });
  slider.addEventListener("pointercancel", () => { scrubbing = false; render(); });
  slider.addEventListener("blur", () => { scrubbing = false; render(); });
  audio.addEventListener("loadedmetadata", () => {
    if (pendingSeek !== null) {
      const time = pendingSeek;
      pendingSeek = null;
      seek(time);
    }
    render();
  });
  audio.addEventListener("durationchange", render);
  audio.addEventListener("playing", () => {
    loading = false;
    status("");
    showRetry(false);
    recovery.playing();
    media.setPlaying(true);
    render();
  });
  audio.addEventListener("pause", () => {
    media.setPlaying(false);
    if (!loading && !audio.error && !audio.ended) recovery.pause();
    save();
    render();
  });
  audio.addEventListener("waiting", () => {
    if (!recovery.intent) return;
    status("Cargando audio…");
    recovery.buffering();
  });
  audio.addEventListener("error", () => {
    if (track) recovery.fail();
  });
  audio.addEventListener("timeupdate", () => {
    if (pendingSeek === null && !audio.ended && audio.readyState > 0) {
      position = audio.currentTime;
      recovery.progress(position);
    }
    if (performance.now() - lastSave > 2000) save();
    media.setPosition(position, durationForUi());
    render();
  });
  audio.addEventListener("ended", () => {
    recovery.pause();
    loading = false;
    position = 0;
    save();
    render();
    onEnd();
  });
  window.addEventListener("online", () => recovery.reconnect());

  if (new URLSearchParams(location.search).has("diagnostico")) {
    diagnostics.hidden = false;
    const events = [];
    const record = type => {
      const seconds = value => Number.isFinite(value) ? value.toFixed(2) : String(value);
      events.push(`${seconds((performance.now() - startedAt) / 1000)} s ${track?.id ?? "—"} ${type} · ${seconds(audio.currentTime)} / ${seconds(audio.duration)} · catálogo ${track?.duration ?? "—"}`);
      diagnostics.textContent = events.slice(-12).join("\n");
      if (events.length > 12) events.shift();
    };
    for (const type of ["loadstart", "loadedmetadata", "durationchange", "playing", "waiting", "stalled", "error", "ended"]) {
      audio.addEventListener(type, () => record(type));
    }
    document.addEventListener("visibilitychange", () => record(document.visibilityState));
  }

  render();
  return {
    load, start, pause, seek,
    isActive: () => loading || (!audio.paused && !audio.ended),
    skip: seconds => seek(position + seconds),
    snapshot: () => ({ track, position }),
  };
}
