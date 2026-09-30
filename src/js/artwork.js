// Extrae el acento de la carátula, salvo que el usuario haya fijado uno.
// Si CORS impide leer el canvas, mantiene el acento predeterminado.

import { els } from "./dom.js";

const DEFAULT_HUE = 213;
const DEFAULT_SAT = 49;

/** Saturación acotada: ni un gris apagado ni un color chillón. */
const SAT_MIN = 32;
const SAT_MAX = 58;

/** Lado del muestreo. 24×24 = 576 píxeles: de sobra y cuesta nada. */
const SAMPLE = 24;

/** Si la miniatura tarda más que esto, no merece la pena esperarla. */
const LOAD_TIMEOUT_MS = 2500;

/**
 * Tono aplicado ahora mismo, sin normalizar a 0-360. Lo guardamos así para
 * poder mover el acento por el arco corto del círculo cromático: pasar de 350°
 * a 10° debe recorrer 20 grados, no 340 barriendo todo el arcoíris de paso.
 */
let currentHue =
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--accent-h")) ||
  DEFAULT_HUE;
// ↑ Parte del tono que ya dejó puesto boot-theme.js (un acento fijo): si
// partiera de 213 llegaría al mismo color por el otro lado del círculo, y al
// arrancar se vería barrer medio arcoíris.

/** Descarta resultados de miniaturas que ya no son la que suena. */
let token = 0;

/**
 * El color que salió de la carátula que suena (`{ hue, sat }`), o null. Se
 * guarda aunque el acento sea fijo: al volver a "De la carátula" se recupera
 * sin esperar a la próxima canción.
 */
let artColor = null;

/**
 * Acento elegido por el usuario (`{ h, s }`), que manda sobre el de la
 * carátula. null: el acento sale de la carátula.
 */
let override = null;

// --- Color ---------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** RGB 0-255 → tono en grados, saturación y luminosidad en 0-1. */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);

  return { h: (h + 360) % 360, s, l };
}

function loadImage(url, { anonymous = false } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";

    const timer = setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
    img.onload = () => (clearTimeout(timer), resolve(img));
    img.onerror = () => (clearTimeout(timer), reject(new Error("no carga")));

    img.src = url;
  });
}

/**
 * Tono y saturación dominantes de la imagen, o `null` si no se pueden leer.
 *
 * El tono se promedia como vector, no como número: la media aritmética de 350°
 * y 10° daría 180° (cian), cuando lo correcto es 0° (rojo).
 */
function dominantColor(img) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);

  let data;
  try {
    data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    // Lienzo contaminado: la miniatura vino sin cabeceras CORS.
    return null;
  }

  let x = 0;
  let y = 0;
  let weightSum = 0;
  let satSum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);

    // Los píxeles casi negros, casi blancos o casi grises no dicen nada del
    // color de la portada: son barras negras, texto y fondos.
    if (l < 0.12 || l > 0.92 || s < 0.15) continue;

    // Pesa más lo saturado y lo de luminosidad media: son los píxeles que una
    // persona identificaría como "el color" de la imagen.
    const weight = s * (1 - Math.abs(l - 0.5) * 0.8);
    const radians = (h * Math.PI) / 180;

    x += Math.cos(radians) * weight;
    y += Math.sin(radians) * weight;
    weightSum += weight;
    satSum += s * weight;
  }

  // Portada monocroma: no hay tono que extraer.
  if (weightSum === 0) return null;

  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { hue, sat: clamp((satSum / weightSum) * 100, SAT_MIN, SAT_MAX) };
}

/** Escribe el acento tomando el camino corto del círculo cromático. */
function applyAccent(hue, sat) {
  const diff = ((hue - currentHue) % 360 + 540) % 360 - 180;
  currentHue += diff;

  const root = document.documentElement;
  root.style.setProperty("--accent-h", currentHue.toFixed(1));
  root.style.setProperty("--accent-s", `${sat.toFixed(1)}%`);
}

/** Quien quiere saber el color de cada carátula (el tema "Carátula"). */
const colorListeners = [];

/** Aviso con `{ hue, sat }` (sat en %) cada vez que cambia, o null sin color. */
export function onColor(callback) {
  colorListeners.push(callback);
}

/** El color de la carátula que suena, o null. */
export function currentColor() {
  return artColor;
}

function announceColor() {
  for (const listener of colorListeners) listener(artColor);
}

/** El acento que toca ahora: el del usuario, el de la carátula o el de serie. */
function refreshAccent() {
  if (override) applyAccent(override.h, override.s);
  else if (artColor) applyAccent(artColor.hue, artColor.sat);
  else applyAccent(DEFAULT_HUE, DEFAULT_SAT);
}

/**
 * Fija el acento (Ajustes › Apariencia), o lo devuelve a la carátula con null.
 * @param {{h:number, s:number}|null} accent  tono en grados y saturación en %.
 */
export function setAccentOverride(accent) {
  override = accent;
  refreshAccent();
}

/** La carátula como imagen de fondo, para el fondo "Carátula". */
function setBackdrop(url) {
  const root = document.documentElement;
  if (url) root.style.setProperty("--art-url", `url("${url}")`);
  else root.style.removeProperty("--art-url");
}

// --- API -----------------------------------------------------------------

/**
 * La imagen de la que se lee el color. Las miniaturas .webp de YouTube
 * (`/vi_webp/…`) no mandan permiso CORS y el canvas no deja leerlas; la .jpg
 * del mismo vídeo sí. Se muestrea esa, pequeña, que para un color sobra.
 */
export function sampleUrl(url) {
  const match = /^https:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([\w-]{6,})\//.exec(url ?? "");
  return match ? `https://i.ytimg.com/vi/${match[1]}/mqdefault.jpg` : url;
}

/** Olvida el color de la carátula y avisa. */
function dropColor() {
  const had = artColor;
  artColor = null;
  refreshAccent();
  if (had) announceColor();
}

/** Vuelve al disco de marcador y al azul por defecto. */
export function clearArtwork() {
  token += 1;
  els.artwork.classList.remove("has-art");
  els.artImg.removeAttribute("src");
  setBackdrop(null);
  dropColor();
}

/**
 * Muestra la miniatura y tiñe la app con su color.
 *
 * Son dos cargas distintas de la misma imagen a propósito: la del `<img>` va sin
 * `crossOrigin` para que se vea siempre, pase lo que pase con las cabeceras; la
 * del muestreo va con `crossOrigin` porque sin eso el canvas queda contaminado.
 * Si esa segunda falla, la portada sigue en pantalla y solo se pierde el tinte.
 */
export function setArtwork(url) {
  if (!url) {
    clearArtwork();
    return;
  }

  // El color de la anterior se queda hasta que llegue el de esta: pasar por
  // gris entre canción y canción haría parpadear el tema "Carátula".
  const mine = ++token;
  els.artwork.classList.remove("has-art");
  els.artImg.removeAttribute("src");

  loadImage(url)
    .then(() => {
      if (mine !== token) return;
      els.artImg.src = url;
      els.artwork.classList.add("has-art");
      setBackdrop(url);
    })
    .catch(() => {});

  loadImage(sampleUrl(url), { anonymous: true })
    .then((img) => {
      if (mine !== token) return;

      const color = dominantColor(img);
      // Portada en blanco y negro: sin color que llevarse.
      if (!color) return dropColor();
      artColor = color;
      refreshAccent();
      announceColor();
    })
    .catch(() => {
      // Sin CORS o sin red: el acento y el tema, los de por defecto.
      if (mine === token) dropColor();
    });
}
