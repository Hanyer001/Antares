// Esquema, valores predeterminados y validación de preferencias.
// También se usa al importar ajustes y restablecer secciones.

import { GENRE_IDS } from "./genres.js";

/** Sube cuando cambie el significado de algo guardado y haga falta migrarlo. */
export const VERSION = 2;

// --- Tipos -----------------------------------------------------------------

const bool = (def) => ({ kind: "bool", def });
const num = (def, min, max) => ({ kind: "num", def, min, max });
const oneOf = (def, values) => ({ kind: "enum", def, values });
const color = (def) => ({ kind: "color", def });
/** Un orden de todos los `values` (reordenar pestañas, estanterías). */
const order = (values) => ({ kind: "order", def: [...values], values });
/** Algunos de los `values`, sin repetir (ocultar pestañas, elegir géneros). */
const subset = (def, values) => ({ kind: "subset", def, values });
/** Una combinación de teclas ("Ctrl+Alt+KeyL"), o "" para ninguna. */
const combo = (def) => ({ kind: "combo", def });
/** Texto libre, recortado a `max` caracteres. */
const text = (def, max) => ({ kind: "text", def, max });
/** Una lista de `len` números entre `min` y `max` (las bandas del ecualizador). */
const numList = (len, min, max) => ({ kind: "numList", def: Array(len).fill(0), len, min, max });
/**
 * Una lista de elementos del mismo tipo (palabras, preajustes...), sin
 * repetidos ni vacíos, como mucho `max`.
 */
const list = (item, max) => ({ kind: "list", def: [], item, max });

const isLeaf = (node) => typeof node?.kind === "string";

/**
 * Teclas válidas en un atajo: los nombres de `KeyboardEvent.code`, que son
 * también los que entiende el plugin de atajos globales.
 */
const COMBO_RE =
  /^(?:(?:Ctrl|Alt|Shift|Super)\+)*(?:Key[A-Z]|Digit\d|F\d{1,2}|Arrow(?:Up|Down|Left|Right)|Space|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Insert|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|Backquote|BracketLeft|BracketRight|Backslash|Numpad\w+|Media\w+|AudioVolume\w+)$/;

// --- Esquema ---------------------------------------------------------------

export const THEME_IDS = [
  "dark",
  "oled",
  "midnight",
  "contrast",
  "light",
  "paper",
  "artwork",
  "system",
  "custom",
];

/** Frecuencias del ecualizador, en Hz. */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Las pestañas de la barra lateral (Ajustes va aparte y no se esconde). */
export const TAB_IDS = ["home", "results", "discover", "queue", "history", "lists", "summary"];

/** Las tipografías (sus familias, en themes.js). */
export const FONT_IDS = [
  "inter",
  "system",
  "modern",
  "humanist",
  "soft",
  "classic",
  "serif",
  "editorial",
  "elegant",
  "mono",
  "typewriter",
  "handwritten",
];

/** Las estanterías de Inicio. */
export const SHELF_IDS = [
  "mix",
  "again",
  "genres",
  "because",
  "top",
  "discoveries",
  "artists",
  "lists",
  "explore",
];

/** Atajos dentro de la app, con su tecla de serie. */
export const LOCAL_SHORTCUTS = {
  playPause: "Space",
  next: "Shift+ArrowRight",
  prev: "Shift+ArrowLeft",
  seekForward: "ArrowRight",
  seekBack: "ArrowLeft",
  volumeUp: "ArrowUp",
  volumeDown: "ArrowDown",
  mute: "KeyM",
  shuffle: "KeyS",
  repeat: "KeyR",
  like: "KeyL",
  search: "Slash",
  focus: "KeyF",
  mini: "Ctrl+KeyM",
  fullscreen: "F11",
};

/** Atajos de todo Windows (con la app en segundo plano o minimizada). */
export const GLOBAL_SHORTCUTS = {
  // P de "play". Ctrl+Alt+Espacio parecía lo natural, pero hay programas que
  // ya lo tienen cogido y Windows no deja registrarlo dos veces.
  playPause: "Ctrl+Alt+KeyP",
  next: "Ctrl+Alt+ArrowRight",
  prev: "Ctrl+Alt+ArrowLeft",
  volumeUp: "Ctrl+Alt+ArrowUp",
  volumeDown: "Ctrl+Alt+ArrowDown",
  like: "Ctrl+Alt+KeyL",
  show: "Ctrl+Alt+KeyA",
};

const combos = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, combo(v)]));

export const SCHEMA = {
  appearance: {
    theme: oneOf("dark", THEME_IDS),
    // Los tres colores de los que sale el tema personalizado.
    custom: {
      bg: color("#0b0d12"),
      surface: color("#141824"),
      text: color("#e8eaf0"),
    },
    // De dónde sale el color de acento: la carátula, uno fijo, o ninguno.
    accentMode: oneOf("artwork", ["artwork", "fixed", "mono"]),
    accentColor: color("#8aabd6"),
    background: oneOf("plain", ["plain", "artwork", "image"]),
    backgroundDim: num(70, 0, 95),
    backgroundBlur: num(40, 0, 80),
    scale: oneOf(1, [0.9, 1, 1.1, 1.25, 1.4]),
    density: oneOf("normal", ["compact", "normal", "comfortable"]),
    corners: oneOf("soft", ["sharp", "soft", "round"]),
    motion: oneOf("full", ["full", "reduced", "none"]),
    font: oneOf("inter", FONT_IDS),
    // Tema "Carátula": cuánto color de la portada se lleva la interfaz.
    artTint: oneOf("medium", ["soft", "medium", "strong"]),
  },

  sound: {
    level: bool(true),
    // Un preajuste de serie ("flat", "bass"...), uno propio ("user:Nombre") o
    // "custom" (retocado a mano).
    preset: text("flat", 60),
    bands: numList(EQ_BANDS.length, -12, 12),
    userPresets: list({ name: text("", 40), bands: numList(EQ_BANDS.length, -12, 12) }, 20),
    crossfade: num(0, 0, 12),
  },

  playback: {
    volume: num(0.8, 0, 1),
    muted: bool(false),
    shuffle: bool(false),
    repeat: oneOf("off", ["off", "all", "one"]),
    // "saver": audio de ~70 kbps en vez de ~128 (lo aplica Rust).
    quality: oneOf("high", ["high", "saver"]),
  },

  discovery: {
    adventure: num(0.3, 0, 1),
    autoplay: bool(true),
    // Parámetros del recomendador; corresponden a Tuning en recommend.rs.
    variety: oneOf("normal", ["low", "normal", "high"]),
    freshHours: num(24, 1, 168),
    minSeconds: num(60, 0, 300),
    maxMinutes: num(12, 3, 60),
    excludeWords: list(text("", 40), 100),
    blockedChannels: list(text("", 80), 200),
  },

  interface: {
    // Qué enseña la columna derecha: lo que viene o la letra.
    sideTab: oneOf("upnext", ["upnext", "lyrics"]),
    // La última pestaña abierta, para "Al abrir: donde lo dejé".
    lastTab: oneOf("home", TAB_IDS),
  },

  // Distribución de la ventana.
  layout: {
    sidebar: oneOf("full", ["full", "icons"]),
    // Espejo: lo que suena a la izquierda y la navegación a la derecha.
    mirrored: bool(false),
    sidebarWidth: num(236, 180, 360),
    nowplayingWidth: num(360, 300, 560),
    tabOrder: order(TAB_IDS),
    hiddenTabs: subset([], TAB_IDS),
    startTab: oneOf("home", ["last", ...TAB_IDS]),
    artwork: oneOf("medium", ["hidden", "small", "medium", "large"]),
    // La mitad de abajo de la columna: "A continuación" y la letra.
    upnext: bool(true),
    showRate: bool(true),
    showRadio: bool(true),
    showSleep: bool(true),
    showModes: bool(true),
    showVolume: bool(true),
    miniOnTop: bool(true),
  },

  // El reproductor fuera de la consola (Ajustes › Reproductor): la barra de
  // abajo, como en YouTube Music o Spotify, y el mini reproductor, como el de
  // Apple Music. Solo escritorio.
  player: {
    bar: bool(true),
    barPosition: oneOf("bottom", ["bottom", "top"]),
    // "edge" (Línea arriba): controles a la izquierda y el progreso como una
    // línea en el borde. "inline" (Centrado): controles en medio, con el
    // progreso debajo entre los dos tiempos.
    barProgress: oneOf("edge", ["edge", "inline"]),
    barSize: oneOf("normal", ["compact", "normal", "large"]),
    // "glass": translúcida sobre lo de detrás; "artwork": teñida con la carátula.
    barStyle: oneOf("solid", ["solid", "glass", "artwork"]),
    // "floating": una isla con las esquinas redondeadas, separada del borde.
    barShape: oneOf("full", ["full", "floating"]),
    // El botón de play: el de cada diseño, un círculo lleno o solo el icono.
    barPlay: oneOf("auto", ["auto", "circle", "plain"]),
    // De qué color va lo recorrido y lo encendido: el de la canción o neutro.
    barAccent: oneOf("artwork", ["artwork", "neutral"]),
    barArtwork: bool(true),
    barAlbum: bool(true),
    barRate: bool(true),
    barVolume: bool(true),
    barModes: bool(true),
    barExtras: bool(true),
    // Con la barra puesta, la consola de la derecha se queda con la carátula,
    // el título y la letra, sin repetir los controles (como Spotify).
    consoleControls: bool(false),

    // "artwork": la carátula llena la ventana (Apple Music); "compact": una
    // tira con la carátula pequeña.
    miniStyle: oneOf("artwork", ["artwork", "compact"]),
    miniSize: oneOf("medium", ["small", "medium", "large"]),
    // Los controles, siempre o solo al pasar el ratón (y la carátula limpia).
    miniControls: oneOf("hover", ["hover", "always"]),
    miniLyrics: bool(false),
    miniAlign: oneOf("center", ["center", "left"]),
    // Cuánto oscurece el velo bajo el texto: más, se lee mejor sobre una
    // portada clara.
    miniShade: oneOf("soft", ["soft", "strong"]),
  },

  home: {
    shelfOrder: order(SHELF_IDS),
    hiddenShelves: subset([], SHELF_IDS),
    // Vacío: los que se deducen de lo que escuchas.
    genres: subset([], GENRE_IDS),
  },

  // Comportamiento de los controles.
  behavior: {
    // Clic en una canción suelta (búsqueda, Reciente, Inicio...).
    rowClick: oneOf("now", ["now", "next", "add"]),
    skipSeconds: num(10, 5, 30),
    // En puntos de 0 a 100.
    volumeStep: num(5, 1, 20),
    startup: oneOf("resume", ["resume", "empty", "mix"]),
    notify: bool(false),
  },

  shortcuts: {
    local: combos(LOCAL_SHORTCUTS),
    globalEnabled: bool(false),
    global: combos(GLOBAL_SHORTCUTS),
  },

  lyrics: {
    size: oneOf("medium", ["small", "medium", "large"]),
    align: oneOf("left", ["left", "center"]),
    // Segundos: positivo adelanta la letra, negativo la retrasa.
    offset: num(0, -5, 5),
  },

  system: {
    closeToTray: bool(true),
    autostart: bool(false),
    startHidden: bool(false),
    // Al abrir, mirar si hay una versión nueva de Antares (app_update.rs).
    updateCheck: bool(true),
  },
};

/** Las secciones de primer nivel. */
export const SECTIONS = Object.keys(SCHEMA);

// --- Valores ---------------------------------------------------------------

/** Los valores por defecto de un nodo del esquema (todo, si no se dice). */
export function defaults(node = SCHEMA) {
  if (isLeaf(node)) return Array.isArray(node.def) ? [...node.def] : node.def;
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, defaults(child)]));
}

function sanitizeLeaf(node, value) {
  switch (node.kind) {
    case "bool":
      return typeof value === "boolean" ? value : node.def;

    case "num": {
      const n = typeof value === "number" ? value : Number.NaN;
      return Number.isFinite(n) ? Math.min(Math.max(n, node.min), node.max) : node.def;
    }

    case "enum":
      return node.values.includes(value) ? value : node.def;

    case "color":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
        ? value.toLowerCase()
        : node.def;

    case "order": {
      // Lo que venga válido, en su orden; lo que falte, al final en el de serie.
      const given = Array.isArray(value) ? value.filter((v) => node.values.includes(v)) : [];
      const unique = [...new Set(given)];
      return [...unique, ...node.values.filter((v) => !unique.includes(v))];
    }

    case "subset": {
      if (!Array.isArray(value)) return [...node.def];
      return [...new Set(value.filter((v) => node.values.includes(v)))];
    }

    case "combo":
      return typeof value === "string" && (value === "" || COMBO_RE.test(value)) ? value : node.def;

    case "text":
      return typeof value === "string" ? value.slice(0, node.max) : node.def;

    case "numList": {
      const given = Array.isArray(value) ? value : [];
      return Array.from({ length: node.len }, (_, i) => {
        const n = given[i];
        return typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(n, node.min), node.max) : 0;
      });
    }

    case "list": {
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      const out = [];
      for (const raw of value) {
        const item = sanitize(raw, node.item);
        // Un elemento vacío (una palabra en blanco, un preajuste sin nombre) no vale.
        const key = typeof item === "string" ? item.trim().toLowerCase() : String(item?.name ?? "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(typeof item === "string" ? item.trim() : { ...item, name: item.name.trim() });
      }
      return out.slice(0, node.max);
    }

    default:
      return node.def;
  }
}

/**
 * Deja un valor cualquiera con la forma del esquema: lo que falta o no vale
 * toma el valor por defecto, y lo que sobra se descarta.
 */
export function sanitize(value, node = SCHEMA) {
  if (isLeaf(node)) return sanitizeLeaf(node, value);
  if (node === SCHEMA) value = migrate(value);

  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(node).map(([key, child]) => [key, sanitize(source[key], child)]),
  );
}

/** El nodo del esquema en una ruta ("sound.eq.low"), o undefined. */
export function nodeAt(path) {
  let node = SCHEMA;
  for (const key of path.split(".")) {
    if (!node || isLeaf(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

export function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

/**
 * Una copia de `obj` con `value` en `path`, saneado por su nodo del esquema.
 * Una ruta que no existe en el esquema lanza: sería un error de programación.
 */
export function withPath(obj, path, value) {
  const node = nodeAt(path);
  if (node === undefined) throw new Error(`Preferencia desconocida: ${path}`);

  const keys = path.split(".");
  const clean = sanitize(value, node);

  const put = (target, i) => {
    const copy = { ...target };
    copy[keys[i]] = i === keys.length - 1 ? clean : put(target?.[keys[i]] ?? {}, i + 1);
    return copy;
  };
  return put(obj, 0);
}

// --- Migración -------------------------------------------------------------

/**
 * Pone al día lo guardado por versiones anteriores. Se aplica al sanear todo
 * (al cargar, al importar una copia vieja).
 *
 *   v1 → v2: el ecualizador pasa de 3 bandas (`eq.low/mid/high`) a 10
 *            (`bands`): cada banda vieja cubre las nuevas de su zona.
 */
export function migrate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const eq = value.sound?.eq;
  if (eq && typeof eq === "object") {
    const n = (v) => (typeof v === "number" ? v : 0);
    const [low, mid, high] = [n(eq.low), n(eq.mid), n(eq.high)];
    const { eq: _old, ...sound } = value.sound;
    return {
      ...value,
      sound: { ...sound, bands: [low, low, low, low, mid, mid, mid, high, high, high] },
    };
  }
  return value;
}

function parse(raw) {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

/**
 * Las preferencias que la app guardaba sueltas en localStorage antes de tener
 * un fichero propio. Solo lo que haya: una sección sin nada guardado no
 * aparece, para no pisar con valores por defecto lo que ya esté en el fichero.
 * Sin sanear: eso lo hace `merge` al juntarlas.
 *
 * @param {(key: string) => string|null} getItem  normalmente `localStorage.getItem`
 */
export function fromLegacy(getItem) {
  const read = (key) => {
    try {
      return getItem(key);
    } catch {
      return null;
    }
  };

  const sound = parse(read("antares.sound"));
  const volume = parse(read("antares.volume"));
  const modes = parse(read("antares.modes"));
  const discovery = parse(read("antares.discovery"));
  const sideTab = read("antares.sidetab");
  const tray = read("antares.tray");

  const found = {};
  if (sound) found.sound = sound;
  if (volume || modes) found.playback = { ...(volume ?? {}), ...(modes ?? {}) };
  if (discovery) found.discovery = discovery;
  if (sideTab === "upnext" || sideTab === "lyrics") found.interface = { sideTab };
  if (tray === "on" || tray === "off") found.system = { closeToTray: tray === "on" };
  return found;
}

/**
 * Junta dos juegos de preferencias sección a sección: lo de `over` gana. El
 * resultado sale saneado.
 */
export function merge(base, over) {
  const a = base && typeof base === "object" ? base : {};
  const b = over && typeof over === "object" ? over : {};

  return sanitize(
    Object.fromEntries(SECTIONS.map((section) => [section, { ...a[section], ...b[section] }])),
  );
}
