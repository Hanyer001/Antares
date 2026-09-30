// Pruebas del esquema de preferencias y de los temas (sin navegador).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaults,
  fromLegacy,
  getPath,
  merge,
  nodeAt,
  sanitize,
  THEME_IDS,
  withPath,
} from "../src/js/prefs-schema.js";
import {
  computeLook,
  contrast,
  derivePalette,
  hexToHsl,
  luminance,
  mix,
  paletteFor,
  THEMES,
  toneOf,
} from "../src/js/themes.js";

// --- Esquema ---------------------------------------------------------------

test("los valores por defecto tienen todas las secciones", () => {
  const d = defaults();
  assert.deepEqual(Object.keys(d), [
    "appearance",
    "sound",
    "playback",
    "discovery",
    "interface",
    "layout",
    "player",
    "home",
    "behavior",
    "shortcuts",
    "lyrics",
    "system",
  ]);
  assert.equal(d.appearance.theme, "dark");
  assert.equal(d.playback.volume, 0.8);
  assert.equal(d.system.closeToTray, true);
  // La barra de abajo, de serie, y el mini como el de Apple Music.
  assert.equal(d.player.bar, true);
  assert.equal(d.player.miniStyle, "artwork");
});

test("un valor raro del reproductor vuelve al de serie", () => {
  const clean = sanitize({ player: { barPosition: "izquierda", miniSize: "large", bar: "sí" } });
  assert.equal(clean.player.barPosition, "bottom");
  assert.equal(clean.player.miniSize, "large");
  assert.equal(clean.player.bar, true);
});

test("sanear rellena lo que falta y descarta lo que sobra", () => {
  const clean = sanitize({ sound: { crossfade: 4 }, basura: 1, appearance: { fuente: "x" } });
  assert.equal(clean.sound.crossfade, 4);
  assert.equal(clean.sound.level, true);
  assert.equal(clean.basura, undefined);
  assert.equal(clean.appearance.fuente, undefined);
  assert.equal(clean.appearance.theme, "dark");
});

test("sanear corrige tipos, rangos, opciones y colores", () => {
  const clean = sanitize({
    sound: { crossfade: 99, level: "sí", bands: [-40, "3", Number.NaN, 5] },
    playback: { repeat: "siempre", volume: -1 },
    appearance: { theme: "rosa", scale: 1.1, accentColor: "#ABCDEF", custom: { bg: "rojo" } },
  });

  assert.equal(clean.sound.crossfade, 12);
  assert.equal(clean.sound.level, true);
  assert.deepEqual(clean.sound.bands, [-12, 0, 0, 5, 0, 0, 0, 0, 0, 0], "10 bandas, acotadas");
  assert.equal(clean.playback.repeat, "off");
  assert.equal(clean.playback.volume, 0);
  assert.equal(clean.appearance.theme, "dark");
  assert.equal(clean.appearance.scale, 1.1);
  assert.equal(clean.appearance.accentColor, "#abcdef");
  assert.equal(clean.appearance.custom.bg, defaults().appearance.custom.bg);
});

test("sanear aguanta cualquier cosa", () => {
  for (const basura of [null, undefined, 3, "hola", [1, 2], { appearance: [] }]) {
    assert.deepEqual(sanitize(basura).system, defaults().system);
  }
});

test("withPath cambia una ruta sin tocar el original y la sanea", () => {
  const base = defaults();
  const next = withPath(base, "discovery.freshHours", 500);

  assert.equal(next.discovery.freshHours, 168);
  assert.equal(base.discovery.freshHours, 24, "el original no cambia");
  assert.equal(next.discovery.adventure, 0.3);
  assert.equal(getPath(next, "discovery.freshHours"), 168);
});

test("withPath rechaza rutas que no existen", () => {
  assert.throws(() => withPath(defaults(), "sound.volumen", 1));
  assert.equal(nodeAt("sound.bands.x"), undefined);
});

test("el ecualizador viejo de 3 bandas pasa a 10", () => {
  const clean = sanitize({ sound: { eq: { low: 6, mid: -2, high: 4 }, preset: "bass" } });
  assert.deepEqual(clean.sound.bands, [6, 6, 6, 6, -2, -2, -2, 4, 4, 4]);
  assert.equal(clean.sound.eq, undefined);
  assert.equal(clean.sound.preset, "bass");
});

test("preajustes propios: con nombre, sin repetir y saneados", () => {
  const clean = sanitize({
    sound: {
      userPresets: [
        { name: " Coche ", bands: [20, 1] },
        { name: "coche", bands: [] },
        { name: "", bands: [1] },
        "basura",
      ],
    },
  });
  assert.equal(clean.sound.userPresets.length, 1);
  assert.equal(clean.sound.userPresets[0].name, "Coche");
  assert.deepEqual(clean.sound.userPresets[0].bands.slice(0, 3), [12, 1, 0]);
});

test("listas de palabras: sin vacías ni repetidas", () => {
  const clean = sanitize({ discovery: { excludeWords: ["live", " LIVE ", "", 3, "sped up"] } });
  assert.deepEqual(clean.discovery.excludeWords, ["live", "sped up"]);
});

test("los temas de serie están todos en el esquema", () => {
  for (const theme of THEMES) assert.ok(THEME_IDS.includes(theme.id), theme.id);
});

// --- Migración -------------------------------------------------------------

test("se traen las preferencias sueltas de la versión anterior", () => {
  const old = {
    "antares.sound": JSON.stringify({ level: false, preset: "bass", eq: { low: 6, mid: 0, high: -1 }, crossfade: 5 }),
    "antares.volume": JSON.stringify({ volume: 0.35, muted: true }),
    "antares.modes": JSON.stringify({ shuffle: true, repeat: "all" }),
    "antares.discovery": JSON.stringify({ adventure: 0.6, autoplay: false }),
    "antares.sidetab": "lyrics",
    "antares.tray": "off",
  };
  const migrated = merge(null, fromLegacy((key) => old[key] ?? null));

  assert.equal(migrated.sound.level, false);
  assert.equal(migrated.sound.preset, "bass");
  assert.deepEqual(migrated.sound.bands, [6, 6, 6, 6, 0, 0, 0, -1, -1, -1]);
  assert.equal(migrated.sound.crossfade, 5);
  assert.deepEqual(migrated.playback, {
    volume: 0.35,
    muted: true,
    shuffle: true,
    repeat: "all",
    quality: "high",
  });
  assert.equal(migrated.discovery.adventure, 0.6);
  assert.equal(migrated.discovery.autoplay, false);
  assert.equal(migrated.interface.sideTab, "lyrics");
  assert.equal(migrated.system.closeToTray, false);
  assert.equal(migrated.appearance.theme, "dark");
});

test("sin nada antiguo, o con valores rotos, no se trae nada", () => {
  assert.deepEqual(fromLegacy(() => null), {});
  assert.deepEqual(fromLegacy(() => "{roto"), {});
  assert.deepEqual(
    fromLegacy(() => {
      throw new Error("sin acceso");
    }),
    {},
  );
});

test("lo antiguo se junta con lo guardado sin pisar las demás secciones", () => {
  const saved = withPath(withPath(defaults(), "appearance.theme", "paper"), "playback.volume", 0.5);
  const merged = merge(saved, fromLegacy((key) => (key === "antares.tray" ? "off" : null)));

  assert.equal(merged.appearance.theme, "paper");
  assert.equal(merged.playback.volume, 0.5);
  assert.equal(merged.system.closeToTray, false);
});

test("juntar sanea lo que llega", () => {
  const merged = merge({ sound: { crossfade: 50 } }, { playback: { volume: "alto" } });
  assert.equal(merged.sound.crossfade, 12);
  assert.equal(merged.playback.volume, 0.8);
});

// --- Colores y temas -------------------------------------------------------

test("mezclar, luminancia y contraste", () => {
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#102030", "#102030", 0.7), "#102030");
  assert.equal(luminance("#000000"), 0);
  assert.equal(luminance("#ffffff"), 1);
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("el tono sale del fondo", () => {
  assert.equal(toneOf("#08090b"), "dark");
  assert.equal(toneOf("#eef0f3"), "light");
  assert.equal(toneOf("#efe7d9"), "light");
});

test("cada tema de serie tiene todos sus colores y el texto se lee", () => {
  const keys = Object.keys(THEMES[0].palette);

  for (const { id, palette } of THEMES) {
    assert.deepEqual(Object.keys(palette), keys, `${id}: mismas claves que Grafito`);
    assert.equal(palette.tone, toneOf(palette.bg), `${id}: el tono cuadra con el fondo`);
    assert.ok(contrast(palette.text, palette.surface) >= 7, `${id}: texto sobre tarjetas`);
    assert.ok(contrast(palette.textDim, palette.surface) >= 4.5, `${id}: texto secundario`);
  }
});

test("el tema personalizado deriva una paleta completa", () => {
  const palette = derivePalette({ bg: "#f5f0ff", surface: "#ffffff", text: "#1b1530" });
  assert.equal(palette.tone, "light");
  assert.deepEqual(Object.keys(palette).sort(), Object.keys(THEMES[0].palette).sort());
  assert.ok(contrast(palette.textDim, palette.surface) >= 4.5);
});

test("'Según Windows' sigue al sistema", () => {
  const appearance = { ...defaults().appearance, theme: "system" };
  assert.equal(paletteFor(appearance, true).tone, "dark");
  assert.equal(paletteFor(appearance, false).tone, "light");
});

test("el aspecto: variables, atributos y acento", () => {
  const appearance = {
    ...defaults().appearance,
    theme: "light",
    density: "compact",
    corners: "sharp",
    font: "mono",
    background: "artwork",
    backgroundDim: 50,
    motion: "none",
    accentMode: "fixed",
    accentColor: "#e07a6a",
  };
  const look = computeLook(appearance);

  assert.equal(look.vars["--bg"], THEMES.find((t) => t.id === "light").palette.bg);
  assert.equal(look.vars["--density"], "0.72");
  assert.equal(look.vars["--round"], "0.3");
  assert.match(look.vars["--font-ui"], /Cascadia/);
  assert.equal(look.vars["--backdrop-dim"], "50%");
  assert.deepEqual(look.attrs, { "data-tone": "light", "data-background": "artwork", "data-motion": "none" });

  const { h, s } = hexToHsl("#e07a6a");
  assert.ok(Math.abs(look.accent.h - h) < 0.1);
  assert.ok(Math.abs(look.accent.s - s * 100) < 0.1);
  assert.equal(look.vars["--accent-s"], `${look.accent.s}%`);
});

test("con el acento de la carátula no se fija ningún color", () => {
  const look = computeLook(defaults().appearance);
  assert.equal(look.accent, null);
  assert.equal(look.vars["--accent-h"], undefined);

  const mono = computeLook({ ...defaults().appearance, accentMode: "mono" });
  assert.equal(mono.accent.s, 0);
});
