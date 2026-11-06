// Sesión por perfil con lectura síncrona en memoria y respaldo hasta confirmar IndexedDB.
const memory = new Map();
let connection;
function database() {
  return connection ??= new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const request = indexedDB.open("antares.web", 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state")) request.result.createObjectStore("state");
      if (!request.result.objectStoreNames.contains("operations")) request.result.createObjectStore("operations");
    };
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  });
}
function get(db, store, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function readCachedSession(key) {
  if (memory.has(key)) return memory.get(key);
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
export function persistSession(key, state) {
  memory.set(key, state);
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* IndexedDB puede seguir disponible. */ }
  return database().then(async db => {
    if (!db) return;
    await write("state", store => store.put(state, key));
    const saved = await get(db, "state", key);
    const legacy = JSON.parse(localStorage.getItem(key) || "null");
    if (saved?.savedAt === state?.savedAt && (!legacy || legacy.savedAt <= saved?.savedAt)) localStorage.removeItem(key);
  }).catch(() => { /* El respaldo síncrono permanece disponible. */ });
}
export async function hydrateSession() {
  const profile = localStorage.getItem("antares.web.profile") || "main";
  const key = webDeviceKey("antares.session" + (profile === "main" ? "" : "." + profile));
  const legacyOwner = key.startsWith("antares.session");
  let state = readCachedSession(key);
  const db = await Promise.race([database(), new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  if (db) {
    const saved = await get(db, "state", key).catch(() => null);
    if (saved && (!state || saved.savedAt > state.savedAt)) state = saved;
    if (!state && legacyOwner && profile === "main" && db.objectStoreNames.contains("playback")) {
      state = await get(db, "playback", "antares.web.session").catch(() => null);
    }
  }
  if (!state && legacyOwner && profile === "main") {
    try { state = JSON.parse(localStorage.getItem("antares.web.session") || "null"); } catch { /* Sin sesión anterior. */ }
  }
  if (state) {
    persistSession(key, state);
    if (state.repeat) localStorage.setItem("antares.web.legacyPlayback", JSON.stringify({ playback: { repeat: state.repeat, shuffle: state.queue?.shuffled === true } }));
  }
}


export async function readWebCache(key) {
  const db = await database();
  return db ? get(db, "state", key) : undefined;
}

async function write(store, change) {
  const db = await database();
  if (!db) throw new Error("El navegador no pudo abrir el almacenamiento local.");
  await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("No se pudo guardar el cambio local."));
    change(tx.objectStore(store));
  });
}

export const writeWebCache = (key, value) => write("state", store => store.put(value, key));
export const removeOperation = key => write("operations", store => store.delete(key));

export async function queueOperation(scope, operation) {
  const db = await database();
  if (!db) throw new Error("El navegador no pudo abrir el almacenamiento local.");
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "operations"], "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("No se pudo guardar el cambio local."));
    const state = tx.objectStore("state");
    const counter = `operation-counter:${scope}`;
    const previous = state.get(counter);
    previous.onsuccess = () => {
      const order = Math.max((previous.result ?? 0) + 1, Date.now());
      const key = [scope, order, operation.args.operationId];
      state.put(order, counter);
      tx.objectStore("operations").add({ ...operation, key }, key);
    };
  });
}

export async function pendingOperations(scope) {
  const db = await database();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const range = IDBKeyRange.bound([scope], [scope, []], false, true);
    const request = db.transaction("operations").objectStore("operations").getAll(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}


export async function acknowledgeOperation(operation, snapshots, project) {
  const db = await database();
  if (!db) throw new Error("No se pudo confirmar el cambio en este dispositivo.");
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["state", "operations"], "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("No se pudo confirmar el cambio local."));
    const operations = tx.objectStore("operations");
    const pending = operations.get(operation.key);
    pending.onsuccess = () => {
      if (!pending.result) return;
      const state = tx.objectStore("state");
      const request = state.get(snapshots.library);
      request.onsuccess = () => {
        try {
          state.put(project(request.result), snapshots.library);
          if (snapshots.rating) state.put(snapshots.rating.value, snapshots.rating.key);
          operations.delete(operation.key);
        } catch {
          tx.abort();
        }
      };
    };
  });
}

// La primera cuenta conserva sus claves previas. Cada pestaña usa la misma
// cuenta hasta que se recarga, incluso si otra pestaña cambia de biblioteca.
let deviceNamespace;
export function bindWebDevice() { deviceNamespace = namespace(); }

function namespace() {
  const owner = localStorage.getItem("antares.web.deviceOwner");
  const account = localStorage.getItem("antares.web.account")?.slice(0, 24);
  return account && owner && account !== owner ? `antares.device.${account}.` : "";
}

export function webDeviceKey(base) {
  return (deviceNamespace ?? namespace()) + base;
}
