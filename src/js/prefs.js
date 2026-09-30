// Lectura, actualización y notificaciones de preferencias.
// Rust las persiste en settings.json; prefs-schema.js define su validación.
//
// Ejemplo: prefs.set("sound.crossfade", 6) guarda el valor y avisa
// a los suscriptores de prefs.on("sound", callback).

import * as schema from "./prefs-schema.js";
import * as user from "./user.js";

const { invoke } = window.__TAURI__.core;

/** Espera tras el último cambio antes de escribir: un deslizador manda decenas. */
const SAVE_DELAY_MS = 300;

/**
 * Lo que guarda un perfil ("Trabajo", "Fiesta"...): cómo se ve, cómo se
 * reparte, cómo suena y cómo recomienda. No el volumen, ni los atajos, ni lo
 * del sistema, que son de la persona y no del momento.
 */
export const PROFILE_SECTIONS = ["appearance", "layout", "player", "home", "sound", "discovery", "behavior", "lyrics"];
const MAX_PROFILES = 20;

let current = schema.defaults();
const listeners = [];
let saveTimer = null;

/** Perfiles: `{ id, name, settings }`, y el último aplicado. */
let profiles = [];
let activeProfile = null;
const profileListeners = [];

/** Si `a` y `b` son la misma ruta, o una contiene a la otra. */
function related(a, b) {
  return a === "" || b === "" || a === b || b.startsWith(`${a}.`) || a.startsWith(`${b}.`);
}

function notify(changed) {
  for (const { prefix, callback } of listeners) {
    if (!related(prefix, changed)) continue;
    try {
      callback(get(prefix), changed);
    } catch (error) {
      console.error(`Error al aplicar la preferencia ${changed}:`, error);
    }
  }
}

function write() {
  clearTimeout(saveTimer);
  saveTimer = null;

  const value = { version: schema.VERSION, ...current, profiles, activeProfile };
  return invoke("save_settings", { value }).catch((error) =>
    console.warn("No se pudieron guardar los ajustes:", error),
  );
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, SAVE_DELAY_MS);
}

/** Marca de que este localStorage ya se pasó al fichero. */
const MIGRATED_KEY = "antares.prefsMigrated";

/**
 * Lo que había suelto en localStorage y aún no se ha pasado al fichero.
 *
 * La marca es por localStorage y no por fichero a propósito: la versión de
 * desarrollo y la instalada comparten `settings.json` pero no localStorage
 * (tienen distinto origen), y cada una debe traerse lo suyo una vez.
 */
function pendingLegacy() {
  // Lo suelto de localStorage era del único usuario que había: el principal.
  if (!user.isMain()) return {};
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return {};
    return schema.fromLegacy((key) => localStorage.getItem(key));
  } catch {
    return {};
  }
}

/**
 * Carga las preferencias. Hay que esperarla antes de arrancar cualquier módulo
 * que las lea. La primera vez se traen las que la app guardaba sueltas en
 * localStorage, para no perder el volumen ni el ecualizador de nadie.
 */
export async function init() {
  let saved = null;
  try {
    saved = await invoke("get_settings");
  } catch (error) {
    console.warn("No se pudieron leer los ajustes; valen los de por defecto.", error);
  }

  const legacy = pendingLegacy();
  current = schema.merge(saved, legacy);
  profiles = sanitizeProfiles(saved?.profiles);
  activeProfile = profiles.some((p) => p.id === saved?.activeProfile) ? saved.activeProfile : null;

  // Un fichero de una versión anterior se reescribe ya migrado.
  if (!saved || Object.keys(legacy).length > 0 || saved.version !== schema.VERSION) {
    try {
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      // Sin almacenamiento tampoco había nada que migrar.
    }
    await write();
  }
}

/** El valor en una ruta, o todas las preferencias sin ruta. Siempre una copia. */
export function get(path = "") {
  const value = path ? schema.getPath(current, path) : current;
  return value && typeof value === "object" ? structuredClone(value) : value;
}

/** El valor por defecto en una ruta. */
export function defaults(path) {
  const node = schema.nodeAt(path);
  if (node === undefined) throw new Error(`Preferencia desconocida: ${path}`);
  return schema.defaults(node);
}

/** Cambia una preferencia (se sanea con el esquema), avisa y la guarda. */
export function set(path, value) {
  const next = schema.withPath(current, path, value);
  if (JSON.stringify(schema.getPath(next, path)) === JSON.stringify(schema.getPath(current, path))) {
    return;
  }

  current = next;
  notify(path);
  scheduleSave();
}

/** Vuelve una sección a sus valores de por defecto. */
export function reset(section) {
  replaceSection(section, schema.defaults(schema.SCHEMA[section]));
}

/** Sustituye una sección entera (al importar un tema, por ejemplo). */
export function replaceSection(section, value) {
  if (!(section in schema.SCHEMA)) throw new Error(`Sección desconocida: ${section}`);

  current = { ...current, [section]: schema.sanitize(value, schema.SCHEMA[section]) };
  notify(section);
  scheduleSave();
}

/** Sustituye todas las preferencias (importar una copia, restablecer todo). */
export function replaceAll(value) {
  current = schema.sanitize(value);
  notify("");
  scheduleSave();
}

/**
 * Avisa de los cambios en una ruta: la suya, las de dentro y las de fuera
 * ("sound" se entera de "sound.eq.low" y de un restablecer todo).
 */
export function on(prefix, callback) {
  listeners.push({ prefix, callback });
}

/** Escribe ya lo pendiente: al salir de la app. */
export function flush() {
  if (saveTimer) return write();
  return Promise.resolve();
}

// --- Perfiles ------------------------------------------------------------

function snapshot() {
  return Object.fromEntries(PROFILE_SECTIONS.map((section) => [section, get(section)]));
}

function sanitizeProfiles(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim())
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_PROFILES)
    .map((p) => ({
      id: p.id,
      name: p.name.trim().slice(0, 40),
      // Solo sus secciones, saneadas: un perfil de otra versión no rompe nada.
      // Una sección que no tenía (el perfil es de antes de que existiera) no
      // se inventa: al ponerlo, esa parte se queda como está.
      settings: Object.fromEntries(
        PROFILE_SECTIONS.filter((s) => p.settings?.[s]).map((s) => [
          s,
          schema.sanitize(p.settings[s], schema.SCHEMA[s]),
        ]),
      ),
    }));
}

function profilesChanged() {
  for (const listener of profileListeners) listener(listProfiles(), activeProfile);
  scheduleSave();
}

export function listProfiles() {
  return profiles.map(({ id, name }) => ({ id, name }));
}

export function activeProfileId() {
  return activeProfile;
}

export function onProfiles(callback) {
  profileListeners.push(callback);
}

/** Guarda lo que hay ahora como un perfil nuevo. Devuelve su id. */
export function saveProfile(name) {
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!clean) throw new Error("Ponle un nombre al perfil.");
  if (profiles.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Ya hay un perfil «${clean}».`);
  }
  if (profiles.length >= MAX_PROFILES) throw new Error(`Como mucho ${MAX_PROFILES} perfiles.`);

  const id = `p${Date.now().toString(36)}`;
  profiles.push({ id, name: clean, settings: snapshot() });
  activeProfile = id;
  profilesChanged();
  return id;
}

/** Sobrescribe un perfil con lo que hay ahora. */
export function updateProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return;
  profile.settings = snapshot();
  activeProfile = id;
  profilesChanged();
}

/** Pone un perfil: sus secciones sustituyen a las actuales. */
export function applyProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return;

  current = { ...current, ...structuredClone(profile.settings) };
  activeProfile = id;
  notify("");
  profilesChanged();
}

export function renameProfile(id, name) {
  const profile = profiles.find((p) => p.id === id);
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!profile || !clean) return;
  profile.name = clean;
  profilesChanged();
}

export function deleteProfile(id) {
  profiles = profiles.filter((p) => p.id !== id);
  if (activeProfile === id) activeProfile = null;
  profilesChanged();
}

/** Todos los perfiles tal cual, para la copia de los ajustes. */
export function exportProfiles() {
  return structuredClone(profiles);
}

/** Sustituye los perfiles (al importar una copia). */
export function importProfiles(list) {
  profiles = sanitizeProfiles(list);
  if (!profiles.some((p) => p.id === activeProfile)) activeProfile = null;
  profilesChanged();
}
