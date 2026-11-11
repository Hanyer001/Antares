import { runtime } from "./platform.js";
// Enlaza los controles de Ajustes con las preferencias.
// data-pref define la ruta, data-when condiciona la visibilidad y data-reset
// restablece una sección. Los controles específicos viven en sus módulos.

import { saveDocument } from "./documents.js";
import { getWallpaper, setWallpaper } from "./appearance.js";
import * as dialog from "./dialog.js";
import { els } from "./dom.js";
import { SettingsView } from "./rust-core.js";
import { friendlyError } from "./format.js";
import * as prefs from "./prefs.js";
import { defaults, nodeAt, VERSION } from "./prefs-schema.js";

const { invoke } = runtime.core;
const ANDROID = document.documentElement.dataset.platform === "android";

/**
 * Milisegundos que el botón de vaciar se queda esperando confirmación antes de
 * volver a su estado normal. Suficiente para leerlo y decidir, corto como para
 * no dejar un botón armado si te distraes.
 */
const CONFIRM_TIMEOUT_MS = 4000;

/** Un fichero de ajustes normal pesa KB; con imagen de fondo, algo de MB. */
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

let confirmTimer = null;
let boundDirty = false;
let boundFrame = null;

const handlers = {
  onClear: () => {},
  onFullscreen: () => {},
  onMessage: () => {},
};

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

  if (boundDirty) { boundDirty = false; renderBound(); }
}

export function setHistoryCount(count) {
  els.historyCount.textContent =
    count === 0 ? "Sin pistas guardadas" : `${count} pista${count === 1 ? "" : "s"} guardada${count === 1 ? "" : "s"}`;

  els.clearHistoryButton.disabled = count === 0;
  if (count === 0) resetConfirm();
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

function renderBound() {
  settingsView?.sync_preferences(path => String(prefs.get(path)));
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

function requestBound() {
  boundDirty = true;
  if (els.settings.hidden || boundFrame !== null) return;
  boundFrame = requestAnimationFrame(() => {
    boundFrame = null;
    if (!els.settings.hidden && boundDirty) { boundDirty = false; renderBound(); }
  });
}

function bindPrefs() {
  for (const input of els.settings.querySelectorAll("[data-pref]")) {
    // Deslizadores, color y texto, en vivo; lo demás, al soltar o elegir.
    const live = input.type === "range" || input.type === "color" || input.tagName === "TEXTAREA";
    input.addEventListener(live ? "input" : "change", () => {
      prefs.set(input.dataset.pref, readControl(input));
    });
  }

  prefs.on("", requestBound);
}

// La vista Rust conserva los controles existentes y su conexión con el sistema.
let settingsView;

export function openGroup(name) {
  settingsView?.open_group(name);
}

function filter(query) {
  settingsView?.filter(query);
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
  settingsView = new SettingsView(els.settings, els.settingsNone, ANDROID);
  els.settings.addEventListener("click", event => {
    const button = event.target.closest(".settings__toggle, .settings__subtoggle");
    if (button) settingsView.toggle(button);
  });
  renderBound();

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
