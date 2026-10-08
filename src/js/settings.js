// Enlaza los controles de Ajustes con las preferencias.
// data-pref define la ruta, data-when condiciona la visibilidad y data-reset
// restablece una sección. Los controles específicos viven en sus módulos.

import { saveDocument } from "./documents.js";
import { getWallpaper, setWallpaper } from "./appearance.js";
import * as dialog from "./dialog.js";
import { els } from "./dom.js";
import { friendlyError } from "./format.js";
import * as prefs from "./prefs.js";
import { defaults, nodeAt, VERSION } from "./prefs-schema.js";

const { invoke } = window.__TAURI__.core;
const ANDROID = document.documentElement.dataset.platform === "android";
const MOBILE_SUMMARIES = { appearance: "Diseños, colores y tipografías", layout: "Navegación y controles", home: "Secciones, orden y géneros", behavior: "Calidad, cola, privacidad y letras", discovery: "Solo música y tus preferencias", sound: "Ecualizador y volumen", mobile: "Batería, precarga y respuesta táctil", people: "Tus perfiles de personalización", data: "Biblioteca, copias e historial" };

/**
 * Milisegundos que el botón de vaciar se queda esperando confirmación antes de
 * volver a su estado normal. Suficiente para leerlo y decidir, corto como para
 * no dejar un botón armado si te distraes.
 */
const CONFIRM_TIMEOUT_MS = 4000;

/** Un fichero de ajustes normal pesa KB; con imagen de fondo, algo de MB. */
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

let confirmTimer = null;
let versionLoaded = false;

const handlers = {
  onOpen: () => {},
  onUpdate: () => {},
  onClear: () => {},
  onFullscreen: () => {},
  onMessage: () => {},
};

export function onOpen(cb) {
  handlers.onOpen = cb;
}
export function onUpdate(cb) {
  handlers.onUpdate = cb;
}
export function onClear(cb) {
  handlers.onClear = cb;
}
export function onFullscreen(cb) {
  handlers.onFullscreen = cb;
}
/** Avisos para la consola: `(texto, "ok" | "error")`. */
export function onMessage(cb) {
  handlers.onMessage = cb;
}

const say = (text, tone = "ok") => handlers.onMessage(text, tone);

/** Devuelve el botón de vaciar a su estado de reposo. */
function resetConfirm() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  els.clearHistoryButton.textContent = "Vaciar";
  els.clearHistoryButton.classList.remove("is-armed");
}

/** Muestra u oculta la vista. */
export function show(visible) {
  els.settings.hidden = !visible;
  els.settingsSearchBox.hidden = !visible;

  if (!visible) {
    resetConfirm();
    if (els.settingsSearch.value) {
      els.settingsSearch.value = "";
      filter("");
    }
    return;
  }

  // La versión se pide una sola vez por sesión: preguntársela al binario cuesta
  // ~1 s porque arranca PyInstaller, y no cambia mientras la app está abierta
  // salvo que la actualices desde aquí.
  if (!versionLoaded) {
    versionLoaded = true;
    handlers.onOpen();
  }
}

export function setVersion(version) {
  els.engineVersion.textContent = version ? `Versión ${version}` : "No disponible";
}

export function setHistoryCount(count) {
  els.historyCount.textContent =
    count === 0 ? "Sin pistas guardadas" : `${count} pista${count === 1 ? "" : "s"} guardada${count === 1 ? "" : "s"}`;

  els.clearHistoryButton.disabled = count === 0;
  if (count === 0) resetConfirm();
}

export function setUpdating(busy) {
  els.updateButton.disabled = busy;
  els.updateButton.textContent = busy ? "Buscando…" : "Buscar actualización";
}

// --- Controles enlazados a preferencias ----------------------------------

/** El valor de un control, con el tipo que espera su preferencia. */
function readControl(input) {
  if (input.type === "checkbox") return input.checked;

  const node = nodeAt(input.dataset.pref);
  // Un sí/no también puede ir en dos radios ("Normal" / "En espejo").
  if (node?.kind === "bool") return input.value === "true";
  const numeric = node?.kind === "num" || (node?.kind === "enum" && typeof node.def === "number");
  return numeric ? Number(input.value) : input.value;
}

/** `ruta==valor` o `ruta!=valor`: si la condición de una fila se cumple. */
function whenHolds(condition) {
  const match = /^([\w.]+)(==|!=)(.*)$/.exec(condition);
  if (!match) return true;

  const [, path, op, expected] = match;
  const equal = String(prefs.get(path)) === expected;
  return op === "==" ? equal : !equal;
}

function renderBound() {
  for (const input of els.settings.querySelectorAll("[data-pref]")) {
    const value = prefs.get(input.dataset.pref);

    if (input.type === "radio") {
      input.checked = String(value) === input.value;
    } else if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else if (input.value !== String(value)) {
      // Solo si cambió: reescribir un campo de texto mientras se escribe en él
      // mandaría el cursor al final.
      input.value = String(value);
    }

    if (input.type === "range") {
      const min = Number(input.min);
      const max = Number(input.max);
      input.style.setProperty("--level", `${((Number(value) - min) / (max - min)) * 100}%`);
    }
  }

  for (const label of els.settings.querySelectorAll("[data-pref-value]")) {
    label.textContent = `${prefs.get(label.dataset.prefValue)}${label.dataset.unit ?? ""}`;
  }

  for (const row of els.settings.querySelectorAll("[data-when]")) {
    row.hidden = !whenHolds(row.dataset.when);
  }

  if (ANDROID) {
    const motion = els.settings.querySelector('[data-pref="appearance.motion"]')?.closest(".setting");
    let note = motion?.querySelector(".setting__value");
    if (motion && !note) { note = document.createElement("span"); note.className = "setting__value"; motion.querySelector(".setting__text")?.append(note); }
    if (note) note.textContent = prefs.get("mobile.energySaver") ? "Ahorrar batería limita las animaciones aunque elijas Todas." : "El sistema puede reducirlas si tienes activado Reducir movimiento.";
    const blur = els.settings.querySelector('[data-pref="appearance.backgroundBlur"]');
    if (blur) {
      blur.disabled = prefs.get("mobile.energySaver");
      blur.title = blur.disabled ? "Ahorrar batería fija un desenfoque ligero. Desactívalo para ajustar este valor." : "Desenfoque del fondo";
      if (blur.disabled) els.settings.querySelector('[data-pref-value="appearance.backgroundBlur"]')?.replaceChildren("8 px · ahorro");
    }
  }
  // Lo que se ve depende también de las condiciones: rehacer el filtro.
  filter(els.settingsSearch.value);
}

function bindPrefs() {
  for (const input of els.settings.querySelectorAll("[data-pref]")) {
    // Deslizadores, color y texto, en vivo; lo demás, al soltar o elegir.
    const live = input.type === "range" || input.type === "color" || input.tagName === "TEXTAREA";
    input.addEventListener(live ? "input" : "change", () => {
      prefs.set(input.dataset.pref, readControl(input));
    });
  }

  prefs.on("", renderBound);
  renderBound();
}

// --- Secciones plegables -------------------------------------------------
//
// Cada sección es una barra (icono, nombre y de qué trata) que se abre al
// pulsarla: todo a la vez abruma a quien no conoce la app. Dentro, los
// apartados largos (Reproductor: la barra y el mini) también se pliegan.
// Qué quedó abierto se recuerda en este equipo; al buscar, se abre todo lo
// que coincide.

/** De qué trata cada sección, y su icono (trazos de 24×24). */
const GROUPS = {
  mobile: ["Batería y controles táctiles", "M8 3h8v18H8zM11 18h2"],
  appearance: ["Tema, colores, fondo, tamaño y tipografía", "M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.3 1.6-1.3H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01"],
  layout: ["Columnas, pestañas, carátula y botones de la consola", "M3.5 4.5h17v15h-17zM9 4.5v15M15 4.5v15"],
  player: ["La barra de reproducción y el mini reproductor", "M3.5 15.5h17v4h-17zM6.5 17.5h.01M10 12l4.5-3L10 6z"],
  home: ["Qué secciones salen en Inicio y tus géneros", "M4 11l8-7 8 7M6 9.5V20h12V9.5"],
  behavior: ["Clics, saltos, volumen, al abrir, avisos y letra", "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"],
  discovery: ["Cómo se eligen las canciones que no pediste", "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"],
  shortcuts: ["Las teclas de la app y las de todo Windows", "M3.5 6.5h17v11h-17zM7 10h.01M11 10h.01M15 10h.01M7.5 14h9"],
  sound: ["Nivelar el volumen, ecualizador y transiciones", "M6 20V10M6 6V4M12 20v-4M12 12V4M18 20v-8M18 8V4M4 8h4M10 14h4M16 10h4"],
  system: ["Bandeja, inicio con Windows y el motor de reproducción", "M3.5 4.5h17v12h-17zM9 20.5h6M12 16.5v4"],
  people: ["Perfiles de ajustes y varias personas en el mismo equipo", "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 3.6a3.5 3.5 0 0 1 0 6.8"],
  data: ["Copias de seguridad, historial y restablecer", "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
};

const OPEN_KEY = "antares.settingsOpen";

function readOpen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const opened = readOpen();

function saveOpen() {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...opened]));
  } catch {
    // Sin almacenamiento, simplemente no se recuerda.
  }
}

function svg(path, className) {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("aria-hidden", "true");
  if (className) node.setAttribute("class", className);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  node.append(p);
  return node;
}

const CHEVRON = "m6 9 6 6 6-6";

function setOpen(key, box, button, open) {
  if (ANDROID && open && box.classList.contains("settings__group")) {
    for (const other of els.settings.querySelectorAll(".settings__group.is-open")) {
      if (other === box) continue;
      other.classList.remove("is-open");
      other.querySelector(".settings__toggle")?.setAttribute("aria-expanded", "false");
      opened.delete(other.dataset.group);
    }
  }
  box.classList.toggle("is-open", open);
  button.setAttribute("aria-expanded", String(open));
  if (open) opened.add(key);
  else opened.delete(key);
  saveOpen();
}

/** Un apartado dentro de una sección: su título pasa a ser un botón. */
function buildSub(group, subhead, index) {
  const key = `${group.dataset.group}:${index}`;
  const sub = document.createElement("div");
  sub.className = "settings__sub";

  // Las filas hasta el siguiente apartado son suyas.
  let next = subhead.nextElementSibling;
  while (next && !next.classList.contains("settings__subhead")) {
    const row = next;
    next = next.nextElementSibling;
    sub.append(row);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings__subtoggle";
  button.append(subhead.textContent.trim(), svg(CHEVRON, "settings__chevron"));
  subhead.replaceChildren(button);
  subhead.after(sub);

  const box = document.createElement("div");
  box.className = "settings__subbox";
  subhead.before(box);
  box.append(subhead, sub);

  setOpen(key, box, button, opened.has(key));
  button.addEventListener("click", () => setOpen(key, box, button, !box.classList.contains("is-open")));
}

function buildAccordion() {
  for (const group of els.settings.querySelectorAll(".settings__group")) {
    const name = group.dataset.group;
    const title = group.querySelector(".settings__title");
    const card = group.querySelector(".settings__card");
    const [summary, icon] = GROUPS[name] ?? ["", null];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings__toggle";
    card.id = `settings-card-${name}`;
    button.setAttribute("aria-controls", card.id);

    const names = document.createElement("span");
    names.className = "settings__names";
    const label = document.createElement("span");
    label.className = "settings__name";
    label.textContent = title.textContent.trim();
    const about = document.createElement("span");
    about.className = "settings__summary";
    about.textContent = ANDROID ? MOBILE_SUMMARIES[name] ?? summary : summary;
    names.append(label, about);

    const badge = document.createElement("span");
    badge.className = "settings__icon";
    if (icon) badge.append(svg(icon));

    button.append(badge, names, svg(CHEVRON, "settings__chevron"));
    title.replaceChildren(button);

    setOpen(name, group, button, opened.has(name));
    button.addEventListener("click", () => setOpen(name, group, button, !group.classList.contains("is-open")));

    group.querySelectorAll(".settings__subhead").forEach((subhead, i) => buildSub(group, subhead, i));
  }
}

/** Abre una sección y la trae a la vista (desde otros sitios de la app). */
export function openGroup(name) {
  const group = els.settings.querySelector(`.settings__group[data-group="${name}"]`);
  const button = group?.querySelector(".settings__toggle");
  if (!group || !button) return;
  setOpen(name, group, button, true);
  group.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- Buscador ------------------------------------------------------------

/** Sin tildes ni mayúsculas: "musica" encuentra "Música". */
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Deja a la vista solo las filas que contienen todas las palabras buscadas. */
function filter(query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  let anyVisible = false;

  // Buscando, las secciones y apartados con algo que coincida se abren solos.
  els.settings.classList.toggle("is-searching", words.length > 0);

  for (const group of els.settings.querySelectorAll(".settings__group")) {
    const title = group.querySelector(".settings__name")?.textContent ?? group.querySelector(".settings__title")?.textContent ?? "";
    let visible = 0;

    for (const row of group.querySelectorAll(".setting")) {
      const sub = row.closest(".settings__subbox")?.querySelector(".settings__subtoggle")?.textContent ?? "";
      const haystack = normalize(`${title} ${sub} ${row.textContent} ${row.dataset.keywords ?? ""}`);
      const unavailable = ANDROID ? Boolean(row.closest(".desktop-only")) : Boolean(row.closest(".android-only"));
      const match = !unavailable && words.every((word) => haystack.includes(word));

      row.classList.toggle("is-filtered", !match);
      if (match && !row.hidden) visible += 1;
    }

    // Un apartado sin nada que coincida no se enseña mientras se busca.
    for (const box of group.querySelectorAll(".settings__subbox")) {
      const any = box.querySelector(".setting:not(.is-filtered):not([hidden])");
      box.classList.toggle("is-filtered", words.length > 0 && !any);
    }

    group.hidden = visible === 0;
    group.querySelector(".settings__toggle")?.setAttribute("aria-expanded", String(words.length > 0 ? visible > 0 : group.classList.contains("is-open")));
    anyVisible ||= !group.hidden;
  }

  els.settingsNone.hidden = anyVisible;
  els.settingsNone.textContent = `Ningún ajuste coincide con «${query.trim()}».`;
}

// --- Exportar e importar -------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function exportFile(name, payload, what) {
  try {
    const path = await saveDocument({ name, contents: JSON.stringify(payload, null, 2) });
    // La carpeta se abre sola en el Explorador; la ruta entera sobra.
    if (!path) return;
    const file = path.split(/[\\/]/).pop();
    say(`${what} guardado (${file}).`);
  } catch (error) {
    say(friendlyError(error, "No se pudo guardar el archivo."), "error");
  }
}

function exportTheme() {
  const appearance = prefs.get("appearance");
  const payload = { app: "antares", kind: "theme", version: VERSION, appearance };
  if (appearance.background === "image" && getWallpaper()) payload.wallpaper = getWallpaper();

  exportFile(`antares-tema-${today()}.json`, payload, "Tema");
}

function exportSettings() {
  const payload = {
    app: "antares",
    kind: "settings",
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: prefs.get(),
    profiles: prefs.exportProfiles(),
  };
  if (getWallpaper()) payload.wallpaper = getWallpaper();

  exportFile(`antares-ajustes-${today()}.json`, payload, "Copia de los ajustes");
}

/**
 * Importa un tema o una copia de los ajustes: el fichero dice cuál es. Lo que
 * no encaje en el esquema se descarta y toma el valor por defecto, así que un
 * fichero de otra versión o retocado a mano no rompe nada.
 */
async function importFile(file) {
  if (!file) return;

  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo es demasiado grande.");

    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("El archivo no es un tema ni una copia de Antares.");
    }
    if (data?.app !== "antares") throw new Error("El archivo no es un tema ni una copia de Antares.");

    if (typeof data.wallpaper === "string") await setWallpaper(data.wallpaper);

    if (data.kind === "theme") {
      prefs.replaceSection("appearance", data.appearance);
      say("Tema importado.");
    } else if (data.kind === "settings") {
      prefs.replaceAll(data.settings);
      if (Array.isArray(data.profiles)) prefs.importProfiles(data.profiles);
      say("Ajustes importados.");
    } else {
      throw new Error("El archivo no es un tema ni una copia de Antares.");
    }
  } catch (error) {
    say(friendlyError(error, "No se pudo importar el archivo."), "error");
  }
}

async function resetAll() {
  const ok = await dialog.confirmAction({
    title: "¿Restablecer todos los ajustes?",
    text: "Tema, sonido, volumen y lo demás vuelven a como venían. Tus listas, el historial y lo que has escuchado no se tocan.",
    confirmLabel: "Restablecer",
    danger: true,
  });
  if (!ok) return;

  prefs.replaceAll(defaults());
  say("Ajustes restablecidos.");
}

// --- Arranque ------------------------------------------------------------

export function initSettings() {
  bindPrefs();

  els.updateButton.addEventListener("click", () => handlers.onUpdate());
  els.fullscreenButton.addEventListener("click", () => handlers.onFullscreen());

  els.settingsSearch.addEventListener("input", () => { filter(els.settingsSearch.value); els.settings.scrollTop = 0; });
  els.settingsSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.settingsSearch.value = "";
      filter("");
    }
  });

  // `data-reset` lleva secciones enteras ("layout") o preferencias sueltas
  // ("playback.quality"), separadas por espacios: Reproducción restablece la
  // calidad pero no el volumen, que vive en la misma sección.
  for (const button of els.settings.querySelectorAll("[data-reset]")) {
    const targets = button.dataset.reset.split(/\s+/);
    const title = button.closest(".settings__group")?.querySelector(".settings__title")?.textContent;

    button.addEventListener("click", () => {
      for (const target of targets) {
        if (target.includes(".")) prefs.set(target, prefs.defaults(target));
        else prefs.reset(target);
      }
      say(`${title ?? "Sección"}: restablecido.`);
    });
  }

  els.exportTheme.addEventListener("click", exportTheme);
  els.exportSettings.addEventListener("click", exportSettings);
  for (const button of els.settings.querySelectorAll("[data-import]")) {
    button.addEventListener("click", () => els.importInput.click());
  }
  els.importInput.addEventListener("change", () => {
    importFile(els.importInput.files?.[0]);
    els.importInput.value = "";
  });
  els.resetAll.addEventListener("click", resetAll);

  if (ANDROID) {
    // Solo textos de ayuda: los valores y sus manejadores siguen siendo los mismos.
    const explain = (path, text, title) => {
      const row = els.settings.querySelector(`[data-pref="${path}"]`)?.closest(".setting");
      const box = row?.querySelector(".setting__text");
      if (!box) return;
      if (title) box.querySelector(".setting__label")?.replaceChildren(title);
      let note = box.querySelector(".setting__value");
      if (!note) { note = document.createElement("span"); note.className = "setting__value"; box.append(note); }
      note.textContent = text;
    };
    explain("appearance.density", "Ajusta el espacio entre canciones, tarjetas y ajustes. Los botones conservan un tamaño cómodo para tocar.");
    explain("appearance.corners", "Cambia los bordes de tarjetas, campos y paneles. Los avatares y el botón de reproducción siguen siendo circulares.");
    explain("appearance.font", "Cambia la letra de la app al instante. Cada muestra usa su propia tipografía; todas están incluidas y funcionan sin conexión.");
    explain("appearance.background", "Elige un fondo liso o una imagen tuya. Con imagen puedes ajustar su oscuridad y desenfoque.");
    explain("layout.showRate", "Se aplican al reproductor abierto. Toca el mini reproductor para verlos.", "Controles del reproductor");
    explain("layout.upnext", "Muestra la cola y las letras debajo de los controles, al abrir el reproductor.");
    explain("layout.startTab", "Se aplica la próxima vez que abras la app.");
    explain("lyrics.size", "Cambia el texto de las canciones en la pestaña Letra del reproductor.", "Tamaño de las letras de canciones");
    explain("lyrics.align", "Alinea las letras de canciones dentro del reproductor.");
    explain("mobile.energySaver", "Reduce animaciones y desenfoque, y desactiva las transiciones entre canciones. Conserva tus colores, fondos y preferencias para cuando lo desactives.");
    explain("mobile.prefetch", "Prepara el enlace de la siguiente canción mientras la app está visible. Puede reducir la espera y consume más datos; no descarga la canción completa.");
    for (const group of els.settings.querySelectorAll(".settings__group:not(.desktop-only)")) {
      const reset = group.querySelector(".settings__head [data-reset]");
      if (reset) group.querySelector(".settings__card")?.append(reset);
    }
    const quality = els.settings.querySelector('[data-pref="playback.quality"]')?.closest(".setting");
    quality?.querySelector(".setting__value")?.replaceChildren("Alta elige el mejor audio disponible. Ahorro limita los datos. Se aplica en la próxima canción.");
    els.settings.querySelector('[data-pref="behavior.rowClick"]')?.closest(".setting")?.querySelector(".setting__label")?.replaceChildren("Al tocar una canción");
    els.settings.querySelector('[data-pref="layout.showVolume"]')?.closest("label")?.classList.add("desktop-only");
  }
  // Después de enlazar "Restablecer", que lee el título tal cual.
  buildAccordion();
  filter(els.settingsSearch.value);

  // Pedir un segundo clic antes de borrar el historial, ya que no admite Deshacer.
  els.clearHistoryButton.addEventListener("click", () => {
    if (confirmTimer) {
      resetConfirm();
      handlers.onClear();
      return;
    }

    els.clearHistoryButton.textContent = "¿Seguro?";
    els.clearHistoryButton.classList.add("is-armed");
    confirmTimer = setTimeout(resetConfirm, CONFIRM_TIMEOUT_MS);
  });
}
