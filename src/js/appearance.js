// Aplica las variables y atributos de themes.js y enlaza los controles de apariencia.
// El zoom y la barra de título de Windows se actualizan en Rust al guardar.

import { currentColor, onColor, setAccentOverride } from "./artwork.js";
import { els } from "./dom.js";
import { friendlyError } from "./format.js";
import * as prefs from "./prefs.js";
import {
  artworkPalette,
  computeLook,
  contrast,
  EXTRA_THEMES,
  FONTS,
  paletteFor,
  themeById,
  THEMES,
} from "./themes.js";
import { key } from "./user.js";

const { invoke } = window.__TAURI__.core;

/** Lo que lee boot-theme.js para arrancar ya con el tema puesto (uno por usuario). */
const LOOK_KEY = () => key("antares.look");
const WALLPAPER_KEY = () => key("antares.wallpaper");

/** Lado mayor de la imagen de fondo guardada: de sobra para una pantalla 1080p. */
const WALLPAPER_MAX_SIDE = 1920;
const WALLPAPER_QUALITY = 0.85;

/** Contraste mínimo entre texto y tarjetas antes de avisar (WCAG AA). */
const MIN_CONTRAST = 4.5;

/** Muestras de acento fijo: cómodas de elegir, todas legibles en ambos tonos. */
const ACCENT_SWATCHES = [
  ["#8aabd6", "Acero"],
  ["#6fc3d9", "Cian"],
  ["#7fc8a9", "Menta"],
  ["#a8c97f", "Lima"],
  ["#e6d17a", "Limón"],
  ["#e0a370", "Ámbar"],
  ["#e07a6a", "Coral"],
  ["#e68a9b", "Rosa"],
  ["#b59ae6", "Lavanda"],
];

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let wallpaper = null;

// --- Aplicar -------------------------------------------------------------

function saveLook(look) {
  try {
    localStorage.setItem(LOOK_KEY(), JSON.stringify({ vars: look.vars, attrs: look.attrs }));
  } catch {
    // Sin almacenamiento: el arranque mostrará un instante el tema por defecto.
  }
}

function apply() {
  const appearance = prefs.get("appearance");
  const look = computeLook(appearance, {
    prefersDark: darkQuery.matches,
    artColor: currentColor(),
  });
  const root = document.documentElement;

  for (const [name, value] of Object.entries(look.vars)) root.style.setProperty(name, value);
  for (const [name, value] of Object.entries(look.attrs)) root.setAttribute(name, value);

  setAccentOverride(look.accent);
  saveLook(look);
  render(appearance);
}

function applyWallpaper() {
  const root = document.documentElement;
  if (wallpaper) root.style.setProperty("--wallpaper-url", `url("${wallpaper}")`);
  else root.style.removeProperty("--wallpaper-url");

  els.wallpaperState.textContent = wallpaper ? "Imagen elegida" : "Ninguna imagen elegida";
  els.wallpaperClear.disabled = !wallpaper;
}

// --- Controles -----------------------------------------------------------

/** Las variables de color de una miniatura de tema. */
function previewVars(palette) {
  return [
    `--p-bg:${palette.bg}`,
    `--p-surface:${palette.surface}`,
    `--p-line:${palette.lineStrong}`,
    `--p-text:${palette.text}`,
    `--p-faint:${palette.textFaint}`,
    ...(palette.panel ? [`--p-side:${palette.panel}`] : []),
  ].join(";");
}

function previewLayer(palette) {
  const layer = document.createElement("span");
  layer.className = "tp";
  layer.style.cssText = previewVars(palette);
  layer.innerHTML = '<span class="tp__side"></span><span class="tp__text"></span><span class="tp__card"></span>';
  return layer;
}

function buildThemePicker() {
  const all = [...THEMES, ...EXTRA_THEMES];

  for (const theme of all) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "theme-card";
    card.dataset.theme = theme.id;
    card.setAttribute("role", "radio");

    const preview = document.createElement("span");
    preview.className = "theme-card__preview";
    preview.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "theme-card__name";
    // En el móvil "Según Windows" es "según el sistema": sigue al modo
    // oscuro de Android.
    const android = document.documentElement.dataset.platform === "android";
    name.textContent = theme.id === "system" && android ? "Según el sistema" : theme.name;

    card.append(preview, name);
    card.addEventListener("click", () => chooseTheme(theme.id));
    els.themePicker.append(card);
  }

  // Flechas para moverse entre temas, como en cualquier grupo de radios.
  els.themePicker.addEventListener("keydown", (event) => {
    const cards = [...els.themePicker.querySelectorAll(".theme-card")];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;

    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;

    event.preventDefault();
    const next = cards[(i + step + cards.length) % cards.length];
    next.focus();
    chooseTheme(next.dataset.theme);
  });
}

/**
 * Elegir "Personalizado" por primera vez parte del tema que había: así se
 * retoca en vez de empezar de cero.
 */
function chooseTheme(id) {
  const appearance = prefs.get("appearance");

  if (id === "custom" && appearance.theme !== "custom") {
    const base = paletteFor(appearance, darkQuery.matches);
    const untouched = JSON.stringify(appearance.custom) === JSON.stringify(prefs.defaults("appearance.custom"));
    if (untouched) {
      prefs.set("appearance.custom", { bg: base.bg, surface: base.surface, text: base.text });
    }
  }

  prefs.set("appearance.theme", id);
}

function renderThemePicker(appearance) {
  for (const card of els.themePicker.querySelectorAll(".theme-card")) {
    const id = card.dataset.theme;
    const checked = id === appearance.theme;
    card.setAttribute("aria-checked", String(checked));
    card.tabIndex = checked ? 0 : -1;

    const preview = card.querySelector(".theme-card__preview");
    preview.replaceChildren();

    if (id === "system") {
      preview.append(previewLayer(themeById("dark").palette), previewLayer(themeById("light").palette));
    } else if (id === "custom") {
      preview.append(previewLayer(paletteFor({ ...appearance, theme: "custom" })));
    } else if (id === "artwork") {
      // La miniatura del tema "Carátula" lleva el color de lo que suena ahora.
      preview.append(previewLayer(artworkPalette(currentColor(), appearance.artTint)));
    } else {
      preview.append(previewLayer(themeById(id).palette));
    }
  }
}

function buildSwatches() {
  const picker = els.accentSwatches.querySelector("input[type=color]");

  for (const [color, name] of ACCENT_SWATCHES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.dataset.color = color;
    swatch.style.setProperty("--c", color);
    swatch.title = name;
    swatch.setAttribute("aria-label", name);
    swatch.setAttribute("role", "radio");
    swatch.addEventListener("click", () => prefs.set("appearance.accentColor", color));
    els.accentSwatches.insertBefore(swatch, picker);
  }
}

const ACCENT_HINTS = {
  artwork: "Cambia con cada canción, según su portada",
  fixed: "El brillo se ajusta al tema para que siempre se lea",
  mono: "Sin color: grises y el texto del tema",
};

function render(appearance) {
  renderThemePicker(appearance);

  for (const swatch of els.accentSwatches.querySelectorAll(".swatch")) {
    swatch.setAttribute("aria-checked", String(swatch.dataset.color === appearance.accentColor));
  }
  els.accentHint.textContent = ACCENT_HINTS[appearance.accentMode];

  const palette = paletteFor(appearance, darkQuery.matches);
  els.contrastWarning.hidden =
    appearance.theme !== "custom" || contrast(palette.text, palette.surface) >= MIN_CONTRAST;
}

// --- Imagen de fondo -----------------------------------------------------

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo abrir la imagen."));
    img.src = url;
  });
}

/** Reduce la imagen a un JPEG razonable: una foto de 12 MP no hace falta entera. */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, WALLPAPER_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", WALLPAPER_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** La imagen de fondo actual (data URL) o null. Para exportar el tema. */
export function getWallpaper() {
  return wallpaper;
}

/** Pone la imagen en pantalla y la copia para el arranque (boot-theme.js). */
function useWallpaper(image) {
  wallpaper = image;

  try {
    if (image) localStorage.setItem(WALLPAPER_KEY(), image);
    else localStorage.removeItem(WALLPAPER_KEY());
  } catch {
    // Sin sitio: el arranque la pondrá cuando llegue de Rust.
  }

  applyWallpaper();
}

/** Cambia la imagen de fondo: la guarda Rust y se usa ya. */
export async function setWallpaper(image) {
  await invoke("set_wallpaper", { image });
  useWallpaper(image);
}

async function pickWallpaper(file) {
  if (!file) return;

  try {
    await setWallpaper(await shrink(file));
    prefs.set("appearance.background", "image");
  } catch (error) {
    handlers.error(friendlyError(error, "No se pudo usar esa imagen. Prueba con otra."));
  }
}

// --- Arranque ------------------------------------------------------------

const handlers = { error: () => {} };

/** Mensajes de error para la consola (imagen que no abre, etc.). */
export function onError(callback) {
  handlers.error = callback;
}

export async function initAppearance() {
  buildThemePicker();
  buildSwatches();

  // Cada opción de tipografía se escribe en su propia letra.
  for (const span of document.querySelectorAll("[data-font]")) {
    span.style.fontFamily = FONTS[span.dataset.font];
  }

  prefs.on("appearance", apply);
  // El tema "Carátula" cambia con cada canción; los demás, solo su miniatura.
  onColor(() => {
    if (prefs.get("appearance.theme") === "artwork") apply();
    else renderThemePicker(prefs.get("appearance"));
  });
  // "Según Windows" sigue al sistema en vivo.
  darkQuery.addEventListener("change", () => {
    if (prefs.get("appearance.theme") === "system") apply();
  });

  apply();

  els.wallpaperPick.addEventListener("click", () => els.wallpaperInput.click());
  els.wallpaperInput.addEventListener("change", () => {
    pickWallpaper(els.wallpaperInput.files?.[0]);
    els.wallpaperInput.value = "";
  });
  els.wallpaperClear.addEventListener("click", async () => {
    await setWallpaper(null).catch((error) => handlers.error(friendlyError(error)));
    prefs.set("appearance.background", "plain");
  });

  // Usar la copia local mientras llega el fondo guardado en Rust, que tiene prioridad.
  try {
    wallpaper = localStorage.getItem(WALLPAPER_KEY());
  } catch {
    wallpaper = null;
  }
  applyWallpaper();

  try {
    const saved = (await invoke("get_wallpaper")) ?? null;
    if (saved !== wallpaper) useWallpaper(saved);
  } catch (error) {
    console.warn("No se pudo leer la imagen de fondo:", error);
  }
}
