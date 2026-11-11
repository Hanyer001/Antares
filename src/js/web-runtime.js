import { API, WEB_VERSION } from "../config.js";
import { createAudioResolver } from './audio-resolver.js';
import { acknowledgeOperation, readWebCache, writeWebCache, webDeviceKey } from "./web-storage.js";
import { createLibrarySync, libraryWrites, overlayLibrary, pendingRating, transient } from "./web-library-sync.js";
import { createLatestSearch } from './latest-search.js';

const api = new URL(API, location.href);
const listeners = new Map();
let tail = Promise.resolve();
let revision;
let activeAccount;
let audioQuality = 'high';
const latestSearch = createLatestSearch();
const PROFILE_KEY = "antares.web.profile";
function eventId() {
  return crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function installation() {
  if (activeAccount) return activeAccount;
  let key = localStorage.getItem("antares.web.account");
  if (!/^[a-f0-9]{64}$/.test(key ?? "")) {
    key = [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("antares.web.account", key);
  }
  if (!localStorage.getItem("antares.web.deviceOwner")) localStorage.setItem("antares.web.deviceOwner", key.slice(0, 24));
  activeAccount = key;
  return activeAccount;
}
let activeProfile;
const profile = () => activeProfile ??= localStorage.getItem(PROFILE_KEY) || "main";
function emit(name, payload) { for (const callback of listeners.get(name) ?? []) callback({ payload }); }
async function listen(name, callback) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(callback);
  return () => listeners.get(name).delete(callback);
}
async function request(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('La petición tardó demasiado.', 'TimeoutError')), options.timeout ?? 25000);
  try {
    const response = await fetch(new URL(path, api), { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `El servidor respondió ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
function rpc(command, args) {
  const account = installation(), owner = profile();
  const run = () => request(`command/${encodeURIComponent(command)}`, {
    method: "POST",
    timeout: cachedReads.has(command) || command === "restored_workspace" ? 5000 : undefined,
    headers: { "Content-Type": "application/json", "X-Antares-Account": account, "X-Antares-Profile": owner,
      ...(revision === undefined ? {} : { "X-Antares-Revision": String(revision) }) },
    body: JSON.stringify(args),
  }).then(result => {
    if (account !== installation() || owner !== profile()) return result.value;
    if (Number.isSafeInteger(result.revision)) revision = result.revision;
    if (command === 'get_settings') audioQuality = mergeDeviceSettings(result.value)?.playback?.quality === 'saver' ? 'saver' : 'high';
    if (command === "switch_user") {
      localStorage.setItem(PROFILE_KEY, args.id);
      activeProfile = args.id;
      revision = undefined;
    }
    if (args.eventId) writeOutbox(readOutbox().filter(event => event.args.eventId !== args.eventId));
    return result.value;
  });
  // Mantiene el orden de lectura/escritura también durante los guardados de ajustes.
  const task = tail.then(run, run);
  tail = task.catch(() => {});
  return task;
}
const available = () => globalThis.navigator?.onLine !== false;
const scope = () => `${installation().slice(0, 24)}:${profile()}`;
const cacheKey = (command, suffix = "", owner = scope()) => `cache:${owner}:${command}:${suffix}`;
const cachedReads = new Set(["get_users", "get_settings", "get_playlists", "get_history", "get_rating", "get_wallpaper", "get_summary"]);
let syncState = { pending: 0, blocked: null };
const cacheWrite = (key, value) => writeWebCache(key, value).catch(() => {});
const cacheRead = key => readWebCache(key).catch(() => undefined);

const librarySync = createLibrarySync({
  rpc, scope, available,
  update(state) { syncState = state; emit("library-sync", state); },
  async accept(op, owner) {
    const snapshots = { library: cacheKey("get_playlists", "", owner) };
    if (op.args.id === "likes" || op.command === "set_rating") {
      const trackId = op.args.track?.id ?? op.args.trackId;
      snapshots.rating = { key: cacheKey("get_rating", trackId, owner), value: pendingRating(trackId, [op]) };
    }
    await acknowledgeOperation(op, snapshots, lists => overlayLibrary(lists, [op]));
  },
});

async function cached(key, fetchValue) {
  if (available()) {
    try {
      const value = await fetchValue();
      await cacheWrite(key, value);
      return value;
    } catch (error) {
      if (!transient(error)) throw error;
      const value = await cacheRead(key);
      if (value !== undefined) return value;
      throw error;
    }
  }
  return cacheRead(key);
}

const devicePlayback = ["volume", "muted", "repeat", "shuffle", "quality"];
function localSettings() {
  try { return JSON.parse(localStorage.getItem(webDeviceKey(`antares.deviceSettings.${profile()}`)) || "null"); }
  catch { return null; }
}
function mergeDeviceSettings(saved) {
  const local = localSettings();
  if (!local) return saved;
  return { ...saved, ...local, playback: { ...saved?.playback, ...local.playback } };
}

async function saveSettings(value) {
  const playback = Object.fromEntries(devicePlayback.filter(key => key in (value.playback ?? {}))
    .map(key => [key, value.playback[key]]));
  const key = webDeviceKey(`antares.deviceSettings.${profile()}`);
  localStorage.setItem(key, JSON.stringify({ playback, mobile: value.mobile, system: value.system }));
  audioQuality = playback.quality === "saver" ? "saver" : "high";
  const shared = { ...value, playback: { ...value.playback } };
  for (const name of devicePlayback) delete shared.playback[name];
  delete shared.mobile;
  delete shared.system;
  if (!available()) return null;
  const result = await rpc("save_settings", { value: shared });
  await cacheWrite(cacheKey("get_settings"), shared);
  return result;
}

async function readPrivate(command, args) {
  const key = cacheKey(command, args.id ?? "");
  let value;
  try {
    value = await cached(key, () => rpc(command, args));
  } catch (error) {
    if (command === "get_users" && error.status === 403 && profile() !== "main") {
      activeProfile = "main";
      localStorage.removeItem(PROFILE_KEY);
      revision = undefined;
      return readPrivate(command, args);
    }
    if (!transient(error) || command !== "get_playlists") throw error;
  }
  if (command === "get_playlists") return overlayLibrary(value, await librarySync.pending());
  if (command === "get_rating") {
    const pending = pendingRating(args.id, await librarySync.pending());
    if (pending !== undefined || value !== undefined) return pending ?? value;
    const lists = await cacheRead(cacheKey("get_playlists"));
    return lists?.find(list => list.id === "likes")?.tracks.some(track => track.id === args.id) ? "like" : "none";
  }
  if (command === "get_users" && !value) return { current: profile(), users: [{ id: profile(), name: "Principal" }] };
  if (command === "get_history" && !value) return [];
  return value;
}

export function librarySyncState() { return syncState; }
export function syncLibrary() { return librarySync.flush(); }
export function discardLibraryChange(key) { return librarySync.discard(key); }
export function recoveryAvailable() {
  return globalThis.isSecureContext === true
    && (api.protocol === "https:" || ["127.0.0.1", "localhost", "[::1]"].includes(api.hostname));
}

export async function recoveryKey() {
  if (!recoveryAvailable()) throw new Error("Abre Antares por HTTPS para guardar tu clave.");
  await rpc("register_account", {});
  return installation();
}

export async function linkAccount(input, beforeSwitch) {
  if (!recoveryAvailable()) throw new Error("Abre Antares por HTTPS para vincular una cuenta.");
  const key = input.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("La clave de recuperación tiene 64 caracteres.");
  if (key === installation()) return false;
  await request("account/verify", { method: "POST", headers: { "X-Antares-Account": key } });
  await beforeSwitch();
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem("antares.web.legacyPlayback");
  localStorage.setItem("antares.web.account", key);
  return true;
}

window.addEventListener("storage", event => {
  if (event.key === "antares.web.account" && activeAccount && event.newValue !== activeAccount) location.reload();
});

function readOutbox() { try { const events = JSON.parse(localStorage.getItem(webDeviceKey("antares.web.outbox")) || "[]"); return Array.isArray(events) ? events.filter(event => event?.args?.eventId && ["record_play", "record_listen"].includes(event.command)) : []; } catch { return []; } }
function writeOutbox(events) { localStorage.setItem(webDeviceKey("antares.web.outbox"), JSON.stringify(events.slice(-500))); }
export async function flushPendingEvents() {
  const events = readOutbox().filter(event => event.profile === profile());
  if (!events.length) return;
  await rpc("get_settings", {});
  for (const event of events) await rpc(event.command, event.args);
}
window.addEventListener("online", () => {
  flushPendingEvents().catch(console.warn);
  syncLibrary().catch(console.warn);
});
function videoId(query) {
  if (/^[\w-]{11}$/.test(query)) return query;
  try {
    const url = new URL(query);
    if (!["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) return null;
    return url.hostname === "youtu.be" ? url.pathname.slice(1).split("/")[0]
      : url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
  } catch { return null; }
}
const audioResolver = createAudioResolver({ load(id, { quality, fresh }) {
  const query = new URLSearchParams();
  if (quality === 'saver') query.set('saver', 'true');
  if (fresh) query.set('fresh', 'true');
  return request(`track/${encodeURIComponent(id)}?${query}`);
} });
async function audioResult(args) {
  let id = videoId(args.query);
  if (!id) {
    const found = await request(`v1/songs?${new URLSearchParams({ q: args.query })}`);
    id = found[0]?.id;
  }
  if (!id) throw new Error("No encontré una canción para reproducir.");
  const quality = audioQuality;
  const info = await audioResolver.resolve(id, { quality, fresh: args.fresh === true });
  const url = new URL(`audio/${encodeURIComponent(id)}`, api);
  if (quality === 'saver') url.searchParams.set('saver', 'true');
  if (args.fresh) url.searchParams.set("retry", String(Date.now()));
  return { ...info, url: url.href, safe: true };
}
async function saveFile({ name, contents }) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return name; }
    catch (error) { if (error.name === "AbortError") return null; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}
async function invoke(command, args = {}) {
  if (command === "import_playlist" || command === "import_text") {
    const { job } = await rpc("start_import", { ...args, kind: command });
    let preview;
    try {
      const deadline = Date.now() + 20 * 60 * 1000;
      while (Date.now() < deadline) {
        const state = await rpc("import_status", { job });
        emit("import-progress", { done: state.done, total: state.total });
        if (state.error) throw new Error(state.error);
        if (state.ready) { preview = state.preview; break; }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      if (!preview) throw new Error("La importación tardó demasiado. Puedes volver a intentarlo.");
      const { confirmAction } = await import("./dialog.js");
      const missing = preview.missing.length ? `\n\nSin encontrar:\n${preview.missing.join("\n")}` : "";
      const accepted = await confirmAction({ title: `Revisar «${preview.name}»`,
        text: `${preview.count} de ${preview.source_count} canciones encontradas. ${preview.duplicates} repetidas.${missing}`,
        confirmLabel: "Guardar lista", cancelLabel: "Cancelar" });
      if (!accepted) { await rpc("cancel_import", { job }); return null; }
      // Actualiza la revisión: la búsqueda de coincidencias no bloquea otros cambios.
      await rpc("get_settings", {});
      return await rpc("commit_import", { job });
    } catch (error) {
      rpc("cancel_import", { job }).catch(() => {});
      throw error;
    }
  }
  const routes = {
    artist_page: () => `v1/artists/${encodeURIComponent(args.id)}`,
    artist_songs: () => `v1/artists/${encodeURIComponent(args.id)}/songs`,
    album_page: () => `v1/albums/${encodeURIComponent(args.id)}`,
    youtube_list: () => `v1/collections/${encodeURIComponent(args.id)}`,
    artist_for_query: () => `v1/artist?${new URLSearchParams({ q: args.query })}`,
    search_songs: () => `v1/songs?${new URLSearchParams({ q: args.query })}`,
    search_tracks: () => `${document.documentElement.dataset.platform === "android" ? "v1/songs" : "search"}?${new URLSearchParams({ q: args.query, limit: String(args.limit ?? 20) })}`,
    get_lyrics: () => `lyrics/${encodeURIComponent(args.id)}`,
    shelf_more: () => `v1/shelves/${encodeURIComponent(args.browseId)}?${new URLSearchParams(args.params ? { params: args.params } : {})}`,
  };
  if (routes[command]) {
    const search = ['search_tracks', 'search_songs', 'artist_for_query'].includes(command);
    if (command === "get_lyrics") return cached(cacheKey(command, args.id), () => request(routes[command]()));
    return request(routes[command](), search ? { signal: latestSearch.signal(args.query) } : {});
  }
  if (command === "begin_search") { latestSearch.signal(args.query); return; }
  if (command === "get_audio_url") return audioResult(args);
  if (command === "get_settings") {
    const saved = mergeDeviceSettings(await readPrivate(command, args).catch(error => {
      if (transient(error)) return null;
      throw error;
    }));
    audioQuality = saved?.playback?.quality === "saver" ? "saver" : "high";
    if (saved) return saved;
    try { return JSON.parse(localStorage.getItem("antares.web.legacyPlayback") || "null"); } catch { return null; }
  }
  if (command === "save_settings") return saveSettings(args.value);
  if (cachedReads.has(command)) return readPrivate(command, args);
  if (libraryWrites.has(command)) return librarySync.save(command, args);
  if (command === "prefetch_audio_url") {
    const id = videoId(args.query); if (!id) return;
    await audioResolver.resolve(id, { quality: audioQuality });
    return;
  }
  if (command === "export_file") return saveFile(args);
  if (command === "plugin:documents|save") { const name = await saveFile(args); return { cancelled: !name, name }; }
  if (command === "restored_workspace") {
    if (!available()) return null;
    try { return await rpc(command, args); }
    catch (error) { if (transient(error)) return null; throw error; }
  }
  if (command === "get_platform") return "web";
  if (command === "app_version") return `PWA · ${WEB_VERSION}`;
  if (command === "get_audio_proxy_base") return null;
  if (command === "global_shortcuts_available" || command === "get_autostart") return false;
  if (command === "set_global_shortcuts") return Object.keys(args.bindings ?? {}).filter(k => args.bindings[k]);
  if (command === "set_tray_tooltip" || command === "set_thumbbar") { document.title = args.title || args.text || "Antares"; return; }
  if (command === "plugin:player|haptic") { navigator.vibrate?.(12); return; }
  if (command === "take_voice_requests") return [];
  if (command === "notify_track") return; // Media Session muestra la pista sin pedir notificaciones.
  if (command === "check_app_update") {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
    if (registration?.waiting) {
      const worker = registration.waiting;
      const channel = new MessageChannel();
      const version = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 1200);
        channel.port1.onmessage = ({ data }) => { clearTimeout(timer); resolve(data?.version); };
        worker.postMessage({ type: "VERSION" }, [channel.port2]);
      });
      channel.port1.close();
      return { version: version || "web disponible", current: WEB_VERSION, web: true };
    }
    return null;
  }
  if (command === "install_app_update") {
    const registration = await navigator.serviceWorker?.getRegistration();
    const worker = registration?.waiting;
    if (!worker) { location.reload(); return; }
    await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === "activated") finish();
        if (worker.state === "redundant") finish(new Error("La versión preparada ya no está disponible."));
      };
      const finish = error => {
        clearTimeout(timer);
        worker.removeEventListener("statechange", changed);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new Error("La actualización aún no está lista.")), 8000);
      worker.addEventListener("statechange", changed);
      worker.postMessage({ type: "ACTIVATE" });
      changed();
    });
    location.reload();
    return;
  }
  if (command === "set_mini_mode") { document.documentElement.dataset.mode = args.enabled ? "focus" : "normal"; return; }
  if (command === "quit_app") { document.querySelectorAll("audio").forEach(audio => audio.pause()); return; }
  const payload = ["record_play", "record_listen"].includes(command) ? { ...args, eventId: eventId() } : args;
  if (payload.eventId) writeOutbox([...readOutbox(), { command, args: payload, profile: profile() }]);
  return rpc(command, payload);
}
const browserWindow = {
  async isFullscreen() { return Boolean(document.fullscreenElement); },
  async setFullscreen(enabled) { if (enabled) await document.documentElement.requestFullscreen?.(); else await document.exitFullscreen?.(); },
  async onFocusChanged(callback) {
    const focus = () => callback({ payload: document.hasFocus() });
    window.addEventListener("focus", focus); window.addEventListener("blur", focus);
    return () => { window.removeEventListener("focus", focus); window.removeEventListener("blur", focus); };
  },
  async onCloseRequested() { return () => {}; },
  async startDragging() {},
  async close() { document.querySelectorAll("audio").forEach(audio => audio.pause()); },
};
export const runtime = {
  core: { invoke, convertFileSrc: url => url, addPluginListener: async () => { throw new Error("Este navegador no usa plugins nativos."); } },
  event: { listen },
  window: { getCurrentWindow: () => browserWindow },
};
// Permite mostrar errores de arranque sin dejar una pantalla silenciosamente vacía.
window.addEventListener("unhandledrejection", event => console.error("Antares web:", event.reason));
export { rpc, videoId, emit };
