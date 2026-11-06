import { API } from "./config.js";
import { collectionId, createCatalogView, createWebCatalog } from "./catalog.js";
import { createLyrics } from "./lyrics.js";
import { createPlayback } from "./playback.js";
import { initMobileShell } from "./mobile-shell.js";
import { readSession, writeSession, youtubeId } from "./playback-session.js";
import { isMusic } from "./shared/filters.js";
import { iconButton } from "./shared/icons.js";
import { progressiveSearch } from "./shared/progressive-search.js";
import { bindTouchSort, bindMiniSwipe, dropPosition } from "./shared/mobile-interactions.js";
import { friendlyError, formatTime } from "./shared/format.js";
import * as media from "./shared/mediasession.js";
import * as queue from "./shared/queue.js";
import { createSearchCache } from "./shared/search-cache.js";

const byId = id => document.getElementById(id);
const audio = byId("audio");
const query = byId("query");
const results = byId("results");
const searchStatus = byId("search-status");
const playStatus = byId("play-status");
const previous = byId("previous");
const next = byId("next");
const shuffle = byId("shuffle");
const repeat = byId("repeat");
const retry = byId("retry");
const playResults = byId("play-results");
const api = new URL(API, location.href);

async function request(url, signal) {
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  if (!response.ok) {
    const info = await response.json().catch(() => ({}));
    throw new Error(info.error ?? "El servidor de Antares no respondió.");
  }
  return response.json();
}

const search = createSearchCache(query => {
  const url = new URL("search", api);
  url.searchParams.set("q", query);
  return request(url);
});
const setLyrics = createLyrics(byId("lyrics"), audio, (id, signal) =>
  request(new URL(`lyrics/${encodeURIComponent(id)}`, api), signal));
const catalog = createWebCatalog(path => request(new URL(path, api)));
const openCatalog = createCatalogView(byId("catalog"), catalog, {
  makeTrack: resultRow,
  play: playCollection,
  error: error => { searchStatus.textContent = friendlyError(error, "No se pudo cargar el catálogo."); },
});

let searchRequest = 0;
let undoReceipt = null;
let unfiltered = [];
let prepared = "";
let pendingPreparation;
const prefetch = byId("prefetch-next");
const saver = byId("save-data");
const onlyMusic = byId("only-music");
try {
  prefetch.checked = localStorage.getItem("antares.web.prefetch") === "true";
  saver.checked = localStorage.getItem("antares.web.saver") === "true";
} catch { /* El navegador puede impedir el acceso al almacenamiento. */ }

function audioUrl(id, suffix = "") {
  const url = new URL(`audio/${encodeURIComponent(id)}${suffix}`, api);
  if (saver.checked) url.searchParams.set("saver", "true");
  return url.href;
}

const playback = createPlayback({
  audio, toggle: byId("play-toggle"), slider: byId("seek"), elapsed: byId("elapsed"),
  duration: byId("duration"), diagnostics: byId("play-diagnostics"), audioUrl,
  onTrack(track) {
    byId("now-title").textContent = track.title ?? "Sin título";
    byId("now-artist").textContent = track.uploader ?? "";
    setLyrics(track);
  },
  onEnd() {
    const track = queue.repeatMode() === "one" ? queue.current() : queue.next();
    if (track) playback.start(track, { restart: true });
    else playbackStatus("Terminó la cola.");
  },
  onSave: saveSession,
  status: playbackStatus,
  showRetry: visible => { retry.hidden = !visible; },
});
let searchResults = [];

function saveSession(playing, position) {
  const track = queue.current();
  writeSession(queue.snapshot(), track, track?.id === playing?.id ? position : 0, queue.repeatMode());
}

function prepareNext() {
  const track = prefetch.checked && !document.hidden && queue.peekNext();
  const target = track ? audioUrl(track.id, "/prepare") : "";
  if (target === prepared) return;
  pendingPreparation?.abort();
  prepared = target;
  if (!target) return;
  const controller = new AbortController();
  pendingPreparation = controller;
  fetch(target, { signal: controller.signal }).then(response => {
    if (!response.ok) throw new Error("No se pudo preparar la pista.");
  }).catch(() => {
    if (!controller.signal.aborted && pendingPreparation === controller) prepared = "";
  });
}

function playbackStatus(text) {
  playStatus.textContent = text;
  playStatus.hidden = !text;
}

function row(track, select, actions) {
  const item = document.createElement("li");
  item.className = "track";
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", select);
  if (track.thumbnail) {
    const image = document.createElement("img");
    image.src = track.thumbnail;
    image.loading = "lazy";
    image.alt = "";
    button.append(image);
  }
  const description = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = track.title ?? "Sin título";
  const artist = document.createElement("small");
  artist.textContent = [track.uploader, track.duration ? formatTime(track.duration) : null].filter(Boolean).join(" · ");
  description.append(title, artist);
  if (track.queued || track.auto) {
    const origin = document.createElement("small");
    origin.textContent = track.queued ? "Añadida por ti" : "Sugerencia";
    description.append(origin);
  }
  button.append(description);
  item.append(button);

  const controls = document.createElement("div");
  controls.className = "track__actions";
  for (const action of actions) {
    const label = `${action.label}: ${title.textContent}`;
    const extra = action.icon
      ? iconButton({ icon: action.icon, label, className: "track-action", onClick: action.run })
      : document.createElement("button");
    if (!action.icon) {
      extra.type = "button";
      extra.textContent = action.symbol;
      extra.setAttribute("aria-label", label);
      extra.addEventListener("click", action.run);
    }
    extra.disabled = Boolean(action.disabled);
    controls.append(extra);
  }
  item.append(controls);
  return item;
}

function renderQueue() {
  const startIndex = queue.currentIndex() + 1;
  const pending = queue.all().slice(startIndex);
  byId("count").textContent = pending.length ? String(pending.length) : "";
  byId("empty-queue").hidden = pending.length !== 0;
  byId("play-toggle").disabled = !queue.current() && !queue.hasNext();
  byId("clear-queued").hidden = !queue.upcomingQueued().length;
  previous.disabled = !queue.hasPrev();
  next.disabled = !queue.hasNext();
  shuffle.setAttribute("aria-pressed", String(queue.isShuffled()));
  repeat.textContent = { off: "Repetir desactivado", all: "Repetir cola", one: "Repetir pista" }[queue.repeatMode()];
  byId("queue").replaceChildren(...pending.map((track, index) => {
    const item = row(track, () => {
    queue.pointAt(track.id);
    playback.start(track);
  }, [
    { symbol: "↑", label: "Subir en la cola", disabled: index === 0, run: () => queue.move(startIndex + index, startIndex + index - 1) },
    { symbol: "↓", label: "Bajar en la cola", disabled: index === pending.length - 1, run: () => queue.move(startIndex + index, startIndex + index + 1) },
    { icon: "close", label: "Quitar de la cola", run: () => {
      undoReceipt = queue.removeUpcoming(track.id);
      byId("undo-queue").hidden = !undoReceipt;
    } },
    ]);
    item.dataset.index = String(startIndex + index);
    const handle = iconButton({ icon: "grip", label: `Arrastrar para ordenar: ${track.title ?? "canción"}`, className: "queue-grip" });
    item.prepend(handle);
    return item;
  }));
}

function playResult(track) {
  queue.playNow(track);
  playback.start(track);
}

function playCollection(tracks, index, { shuffle = false, ordered = false, artistOnly = false } = {}) {
  queue.setShuffle(shuffle);
  queue.load(tracks, index, { ordered, artistOnly });
  playback.start(queue.current(), { restart: true });
}

function resultRow(track, play = () => playResult(track)) {
  const actions = [
    { icon: "playNext", label: "Reproducir a continuación", run: () => queue.playNext(track) },
    { icon: "plus", label: "Agregar a la cola", run: () => queue.add(track) },
  ];
  if (track.album?.id) actions.unshift({
    symbol: "◉", label: "Abrir álbum", run: () => openCatalog("album", track.album.id),
  });
  return row(track, play, actions);
}

function showArtist(artist) {
  if (!artist) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Artista · ${artist.name}`;
  button.addEventListener("click", () => openCatalog("artist", artist.id));
  byId("search-catalog").append(button);
}

function showResults(tracks) {
  unfiltered = tracks;
  searchResults = tracks.filter(track => /^[\w-]{11}$/.test(track.id) && (!onlyMusic.checked || isMusic(track)));
  results.replaceChildren(...searchResults.map(track => resultRow(track)));
  playResults.hidden = searchResults.length < 2;
  searchStatus.textContent = searchResults.length > 1 ? `${searchResults.length} resultados`
    : searchResults.length === 1 ? "1 resultado" : "No encontré coincidencias.";
}

byId("search").addEventListener("submit", async event => {
  event.preventDefault();
  const text = query.value.trim();
  if (!text) return;
  const request = ++searchRequest;
  openCatalog.cancel();
  unfiltered = [];
  results.replaceChildren();
  byId("search-catalog").replaceChildren();
  playResults.hidden = true;
  searchStatus.textContent = "Buscando…";
  try {
    const list = collectionId(text);
    if (list) {
      searchStatus.textContent = "";
      await openCatalog("list", list);
      return;
    }
    const id = youtubeId(text);
    if (!id && /^https?:\/\//i.test(text)) throw new Error("Pega un enlace de una canción de YouTube o busca por su título.");
    if (id) {
      const track = await fetchTrack(id);
      if (request === searchRequest) showResults([track]);
      return;
    }
    catalog.artistForQuery(text).then(artist => {
      if (request === searchRequest) showArtist(artist);
    });
    const official = new Map();
    const songs = catalog.searchSongs(text).then(tracks => {
      for (const track of tracks) official.set(track.id, track);
      return tracks;
    });
    const update = tracks => {
      if (request === searchRequest) showResults(tracks.map(track => official.get(track.id) ?? track));
    };
    const tracks = await progressiveSearch([search(text), songs], update);
    update(tracks);
  } catch (error) {
    if (request === searchRequest) searchStatus.textContent = friendlyError(error, "No se pudo buscar. Comprueba que el servidor de Antares esté activo.");
  }
});

function fetchTrack(id) {
  return request(new URL(`track/${encodeURIComponent(id)}`, api));
}

function resume() {
  playback.start(queue.current() ?? queue.next());
}

const saved = await readSession();
if (saved && queue.restore(saved.queue)) {
  queue.setRepeat(saved.repeat);
  const track = queue.current();
  if (track) playback.load(track, saved.time);
}
initMobileShell();
bindTouchSort(byId("queue"), {
  rowSelector: ".track", handleSelector: ".queue-grip",
  onMove(row, target, after) {
    const from = Number(row.dataset.index);
    const to = dropPosition(from, Number(target.dataset.index), after);
    queue.move(from, to);
  },
});
bindMiniSwipe(document.querySelector(".player .now"), {
  enabled: () => Boolean(queue.current()),
  next: () => playback.start(queue.next()),
  previous: () => playback.start(queue.prev()),
});
renderQueue();
queue.onChange(() => {
  renderQueue();
  const { track, position } = playback.snapshot();
  saveSession(track, position);
  prepareNext();
});
playResults.addEventListener("click", () => playCollection(searchResults, 0, { shuffle: queue.isShuffled() }));
shuffle.addEventListener("click", () => queue.setShuffle(!queue.isShuffled()));
repeat.addEventListener("click", () => queue.cycleRepeat());
retry.addEventListener("click", () => playback.start(queue.current(), { reload: true }));
previous.addEventListener("click", () => playback.start(queue.prev()));
next.addEventListener("click", () => playback.start(queue.next()));
byId("play-toggle").addEventListener("click", () => playback.isActive() ? playback.pause() : resume());
byId("clear-queued").addEventListener("click", () => queue.clearQueued());
byId("undo-queue").addEventListener("click", event => {
  queue.undoRemove(undoReceipt);
  event.currentTarget.hidden = true;
  undoReceipt = null;
});
onlyMusic.addEventListener("change", () => {
  if (unfiltered.length) showResults(unfiltered);
});
for (const [input, key] of [[prefetch, "prefetch"], [saver, "saver"]]) {
  input.addEventListener("change", () => {
    try { localStorage.setItem(`antares.web.${key}`, String(input.checked)); } catch { /* Ajuste temporal. */ }
    prepareNext();
    if (input === saver && queue.current()) {
      const { position } = playback.snapshot();
      if (playback.isActive()) playback.start(queue.current(), { reload: true });
      else playback.load(queue.current(), position);
    }
  });
}

function persist() {
  const { track, position } = playback.snapshot();
  saveSession(track, position);
}

window.addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persist();
  prepareNext();
});
audio.addEventListener("playing", prepareNext);

media.initMediaSession({
  play: resume,
  pause: playback.pause,
  next: () => playback.start(queue.next()),
  prev: () => playback.start(queue.prev()),
  seek: playback.seek,
  skip: playback.skip,
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Antares PWA:", error));
}
