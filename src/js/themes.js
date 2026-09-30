// Paletas y cálculo de variables y atributos de apariencia.
// computeLook no depende del DOM; su resultado se guarda en localStorage
// para que boot-theme.js aplique el tema antes del primer renderizado.

/** Por encima de esta luminancia, el fondo pide texto oscuro. Igual en settings.rs. */
export const LIGHT_LUMINANCE = 0.18;

// --- Colores ---------------------------------------------------------------

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Mezcla dos colores: `t` = 0 da `a`, 1 da `b`. */
export function mix(a, b, t) {
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  return rgbToHex([ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t]);
}

/** Luminancia relativa (WCAG): 0 el negro, 1 el blanco. */
export function luminance(hex) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1 a 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);
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

/** Tono en grados, saturación y luminosidad en % → "#rrggbb". */
export function hslToHex(h, s, l) {
  const sat = Math.min(Math.max(s, 0), 100) / 100;
  const lum = Math.min(Math.max(l, 0), 100) / 100;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return 255 * (lum - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex([f(0), f(8), f(4)]);
}

export function toneOf(bg) {
  return luminance(bg) > LIGHT_LUMINANCE ? "light" : "dark";
}

// --- Paletas ---------------------------------------------------------------

/**
 * La paleta completa a partir de tres colores. Es lo que hace el tema
 * personalizado, y la base de los temas de serie que no necesitan ajuste fino.
 */
export function derivePalette({ bg, surface, text }) {
  const tone = toneOf(bg);
  const light = tone === "light";

  return {
    tone,
    bg,
    surface,
    surface2: mix(surface, text, 0.035),
    surface3: mix(surface, text, 0.075),
    line: mix(surface, text, 0.1),
    lineStrong: mix(surface, text, 0.17),
    text,
    textDim: mix(text, bg, 0.36),
    textFaint: mix(text, bg, 0.56),
    glow: mix(bg, text, light ? 0.0 : 0.035),
    track: mix(surface, text, 0.1),
    trackBuffered: mix(surface, text, 0.18),
    trackMuted: mix(surface, text, 0.26),
    danger: light ? "#c24848" : "#d98f8f",
    ok: light ? "#2f9e5b" : "#8fd9a8",
  };
}

/** Los temas de serie, en el orden en que se ofrecen. */
export const THEMES = [
  {
    id: "dark",
    name: "Grafito",
    palette: {
      tone: "dark",
      bg: "#08090b",
      surface: "#101216",
      surface2: "#14171c",
      surface3: "#1a1e24",
      line: "#21252c",
      lineStrong: "#2d323b",
      text: "#e7e9ec",
      textDim: "#939aa5",
      textFaint: "#626974",
      glow: "#12151a",
      track: "#1d2127",
      trackBuffered: "#2b313a",
      trackMuted: "#3a414b",
      danger: "#d98f8f",
      ok: "#8fd9a8",
    },
  },
  {
    id: "oled",
    name: "Negro puro",
    palette: {
      tone: "dark",
      bg: "#000000",
      surface: "#0a0a0a",
      surface2: "#101010",
      surface3: "#181818",
      line: "#1d1d1d",
      lineStrong: "#2b2b2b",
      text: "#ececec",
      textDim: "#9a9a9a",
      textFaint: "#646464",
      glow: "#000000",
      track: "#1b1b1b",
      trackBuffered: "#2c2c2c",
      trackMuted: "#3b3b3b",
      danger: "#d98f8f",
      ok: "#8fd9a8",
    },
  },
  {
    id: "midnight",
    name: "Medianoche",
    palette: {
      tone: "dark",
      bg: "#090d19",
      surface: "#0f1527",
      surface2: "#141b31",
      surface3: "#1a223b",
      line: "#222b46",
      lineStrong: "#2e3958",
      text: "#e5e9f6",
      textDim: "#98a2c2",
      textFaint: "#636d8e",
      glow: "#111a33",
      track: "#1a2140",
      trackBuffered: "#2b3456",
      trackMuted: "#3a4466",
      danger: "#e39a9a",
      ok: "#8fd9b0",
    },
  },
  {
    id: "contrast",
    name: "Alto contraste",
    palette: {
      tone: "dark",
      bg: "#000000",
      surface: "#000000",
      surface2: "#0e0e0e",
      surface3: "#1c1c1c",
      line: "#6e6e6e",
      lineStrong: "#a8a8a8",
      text: "#ffffff",
      textDim: "#e6e6e6",
      textFaint: "#c2c2c2",
      glow: "#000000",
      track: "#3a3a3a",
      trackBuffered: "#5c5c5c",
      trackMuted: "#7a7a7a",
      danger: "#ff9c9c",
      ok: "#9dffbf",
    },
  },
  {
    id: "light",
    name: "Claro",
    palette: {
      tone: "light",
      bg: "#eef0f3",
      surface: "#ffffff",
      surface2: "#f6f7f9",
      // Más oscuro que el fondo, no solo que las tarjetas: es el de la
      // pestaña activa de la barra lateral, que va sobre el fondo.
      surface3: "#e2e5ea",
      line: "#e0e3e8",
      lineStrong: "#cbd0d8",
      text: "#15181c",
      textDim: "#525964",
      textFaint: "#7f8691",
      glow: "#f8f9fb",
      track: "#e1e4e9",
      trackBuffered: "#cdd2da",
      trackMuted: "#b7bdc7",
      danger: "#c24848",
      ok: "#2f9e5b",
    },
  },
  {
    id: "paper",
    name: "Papel",
    palette: {
      tone: "light",
      bg: "#efe7d9",
      surface: "#faf5eb",
      surface2: "#f5eee1",
      surface3: "#e5d9c4",
      line: "#e0d4bf",
      lineStrong: "#cfbfa4",
      text: "#2a2318",
      textDim: "#66594a",
      textFaint: "#938571",
      glow: "#f6f0e4",
      track: "#e5dac6",
      trackBuffered: "#d4c6ad",
      trackMuted: "#c2b294",
      danger: "#b44a3c",
      ok: "#3f8a55",
    },
  },
];

/** Los pseudotemas: no traen paleta fija. */
export const EXTRA_THEMES = [
  { id: "artwork", name: "Carátula" },
  { id: "system", name: "Según Windows" },
  { id: "custom", name: "Personalizado" },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) ?? null;
}

/**
 * Cuánto color de la portada se lleva el tema "Carátula": saturación y
 * luminosidad del fondo, las tarjetas y las columnas laterales. Las columnas
 * son las que más se tiñen: con una portada roja, la barra de la izquierda
 * se ve roja.
 */
const ART_TINTS = {
  soft: { sat: 0.5, bg: 7, surface: 10, panel: 11 },
  medium: { sat: 0.85, bg: 8, surface: 11, panel: 15 },
  strong: { sat: 1.15, bg: 10, surface: 14, panel: 21 },
};

/**
 * La paleta del tema "Carátula": oscura, con el tono de la portada que suena.
 *
 * @param {{hue:number, sat:number}|null} color  el de la carátula (sat en %),
 *   o null sin portada o con una en blanco y negro: entonces sale gris.
 * @param {"soft"|"medium"|"strong"} tint
 */
export function artworkPalette(color, tint = "medium") {
  const t = ART_TINTS[tint] ?? ART_TINTS.medium;
  const h = color?.hue ?? 213;
  const s = color ? Math.min(color.sat, 70) * t.sat : 0;

  const bg = hslToHex(h, s * 0.6, t.bg);
  const surface = hslToHex(h, s * 0.5, t.surface);
  const text = hslToHex(h, Math.min(s * 0.4, 25), 93);

  return {
    ...derivePalette({ bg, surface, text }),
    glow: hslToHex(h, s * 0.8, t.bg + 7),
    panel: hslToHex(h, s * 0.9, t.panel),
  };
}

/**
 * La paleta que toca con estas preferencias.
 *
 * @param {object} appearance   La sección `appearance` de las preferencias.
 * @param {boolean} prefersDark Si Windows está en modo oscuro (para "system").
 * @param {{hue:number, sat:number}|null} artColor  El color de la carátula
 *   que suena (para "artwork").
 */
export function paletteFor(appearance, prefersDark = true, artColor = null) {
  if (appearance.theme === "custom") return derivePalette(appearance.custom);
  if (appearance.theme === "artwork") return artworkPalette(artColor, appearance.artTint);
  if (appearance.theme === "system") return themeById(prefersDark ? "dark" : "light").palette;
  return (themeById(appearance.theme) ?? THEMES[0]).palette;
}

// --- El aspecto completo ---------------------------------------------------

/** Qué variable CSS lleva cada color de la paleta. */
const PALETTE_VARS = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  surface3: "--surface-3",
  line: "--line",
  lineStrong: "--line-strong",
  text: "--text",
  textDim: "--text-dim",
  textFaint: "--text-faint",
  glow: "--glow",
  track: "--track",
  trackBuffered: "--track-buffered",
  trackMuted: "--track-muted",
  danger: "--danger",
  ok: "--ok",
};

const DENSITY = { compact: 0.72, normal: 1, comfortable: 1.3 };
const ROUNDNESS = { sharp: 0.3, soft: 1, round: 1.7 };

// Todas salvo Inter (que va dentro de la app) son de las que trae Windows 10 y
// 11, así que no hay nada que descargar. Detrás de cada una va una parecida
// de Android y la genérica, por si falta.
export const FONTS = {
  inter: '"Inter", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  system: '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  // Geométrica y un poco estrecha, de señalética (DIN).
  modern: 'Bahnschrift, "DIN Alternate", "Roboto Condensed", "Segoe UI", sans-serif',
  // Cálida, de trazo caligráfico.
  humanist: 'Candara, Optima, "Noto Sans", "Segoe UI", sans-serif',
  // Redondeada y tranquila.
  soft: 'Corbel, "Segoe UI", "Noto Sans", sans-serif',
  // La sans de toda la vida en pantalla.
  classic: '"Trebuchet MS", Verdana, "Noto Sans", sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  // Serif de revista, pensada para leer en pantalla.
  editorial: '"Sitka Text", Constantia, "Noto Serif", Georgia, serif',
  // Clásica de libro.
  elegant: '"Palatino Linotype", Palatino, "Book Antiqua", "Noto Serif", serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
  typewriter: '"Courier New", Courier, "Noto Sans Mono", monospace',
  handwritten: '"Segoe Print", "Ink Free", "Comic Sans MS", cursive',
};


/**
 * El acento fijo o neutro, en tono y saturación. `null` si sale de la carátula.
 * La luminosidad no: la pone el tema, para que se lea sobre su fondo.
 */
export function accentFor(appearance) {
  if (appearance.accentMode === "mono") return { h: 213, s: 0 };
  if (appearance.accentMode === "fixed") {
    const { h, s } = hexToHsl(appearance.accentColor);
    return { h: Math.round(h * 10) / 10, s: Math.round(s * 1000) / 10 };
  }
  return null;
}

/**
 * Variables y atributos para <html>.
 *
 * @returns {{ vars: Record<string,string>, attrs: Record<string,string>,
 *             accent: {h:number,s:number}|null, tone: "dark"|"light" }}
 */
export function computeLook(appearance, { prefersDark = true, artColor = null } = {}) {
  const palette = paletteFor(appearance, prefersDark, artColor);
  const accent = accentFor(appearance);

  const vars = {};
  for (const [key, name] of Object.entries(PALETTE_VARS)) vars[name] = palette[key];

  // Las columnas laterales: translúcidas sobre el fondo, salvo que la paleta
  // traiga las suyas (el tema "Carátula" las tiñe más que el resto).
  vars["--panel"] = palette.panel ?? "color-mix(in srgb, var(--bg) 55%, transparent)";

  vars["--density"] = String(DENSITY[appearance.density] ?? 1);
  vars["--round"] = String(ROUNDNESS[appearance.corners] ?? 1);
  vars["--font-ui"] = FONTS[appearance.font] ?? FONTS.inter;
  vars["--backdrop-dim"] = `${appearance.backgroundDim}%`;
  vars["--backdrop-blur"] = `${appearance.backgroundBlur}px`;

  if (accent) {
    vars["--accent-h"] = String(accent.h);
    vars["--accent-s"] = `${accent.s}%`;
  }

  return {
    vars,
    attrs: {
      "data-tone": palette.tone,
      "data-background": appearance.background,
      "data-motion": appearance.motion,
    },
    accent,
    tone: palette.tone,
  };
}
