// Filtros del recomendador y tema basado en la carátula.
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { artistKey, containsWord, makeFilter, tuningFrom, VARIETY_PENALTY } from "../src/js/filters.js";
import { friendlyError } from "../src/js/format.js";
import { defaults } from "../src/js/prefs-schema.js";
import { artworkPalette, computeLook, contrast, hexToHsl, hslToHex, THEMES } from "../src/js/themes.js";

const discovery = (over = {}) => ({ ...defaults().discovery, ...over });
const track = (title, uploader, duration = 200) => ({ id: title, title, uploader, duration });

// --- Filtros ---------------------------------------------------------------

test("el canal se normaliza igual que en Rust", () => {
  assert.equal(artistKey("Bebefinn - Topic"), "bebefinn");
  assert.equal(artistKey("RadioheadVEVO"), "radiohead");
  assert.equal(artistKey("  Yan  Block  Oficial "), "yan block");
  assert.equal(artistKey(null), "");
});

test("una palabra cuenta entera", () => {
  assert.ok(containsWord("song (live at wembley)", "live"));
  assert.ok(!containsWord("delivery", "live"));
  assert.ok(containsWord("x - sped up", "sped up"));
  assert.ok(containsWord("canción en vivo", "vivo"));
  assert.ok(!containsWord("vivos", "vivo"));
});

test("el filtro quita palabras, canales y duraciones", () => {
  const allowed = makeFilter(
    discovery({ excludeWords: ["Live"], blockedChannels: ["Bebefinn"], minSeconds: 90, maxMinutes: 5 }),
  );

  assert.ok(allowed(track("Buena", "Alguien")));
  assert.ok(!allowed(track("Buena (Live)", "Alguien")));
  assert.ok(!allowed(track("Perrito", "Bebefinn - Topic")));
  assert.ok(!allowed(track("Corta", "Alguien", 60)));
  assert.ok(!allowed(track("Larga", "Alguien", 400)));
  assert.ok(allowed({ id: "x", title: "Sin duración", uploader: "Alguien" }), "sin duración, no se descarta");
});

test("lo que se manda a Rust", () => {
  const t = tuningFrom(discovery({ variety: "high", maxMinutes: 8 }));
  assert.equal(t.artistPenalty, VARIETY_PENALTY.high);
  assert.equal(t.maxDurationSecs, 480);
  assert.equal(t.freshnessHours, 24);
  assert.ok(VARIETY_PENALTY.low > VARIETY_PENALTY.normal && VARIETY_PENALTY.normal > VARIETY_PENALTY.high);
});

// --- Tema "Carátula" -------------------------------------------------------

test("hsl a hex", () => {
  assert.equal(hslToHex(0, 100, 50), "#ff0000");
  assert.equal(hslToHex(120, 100, 25), "#008000");
  assert.equal(hslToHex(0, 0, 100), "#ffffff");
});

test("con una portada roja, la barra lateral es roja", () => {
  const palette = artworkPalette({ hue: 0, sat: 55 }, "medium");
  const side = hexToHsl(palette.panel);

  assert.ok(side.h < 15 || side.h > 345, `tono rojo, salió ${side.h}`);
  assert.ok(side.s > 0.25, "con color de verdad");
  assert.equal(palette.tone, "dark");
});

test("cuanto más intenso, más color", () => {
  const sat = (tint) => hexToHsl(artworkPalette({ hue: 210, sat: 50 }, tint).panel).s;
  assert.ok(sat("soft") < sat("medium") && sat("medium") < sat("strong"));
});

test("sin color de portada sale gris", () => {
  const palette = artworkPalette(null);
  assert.ok(hexToHsl(palette.panel).s < 0.01);
});

test("el texto del tema Carátula se lee sobre cualquier color", () => {
  for (const hue of [0, 45, 120, 200, 280, 330]) {
    for (const tint of ["soft", "medium", "strong"]) {
      const p = artworkPalette({ hue, sat: 58 }, tint);
      assert.ok(contrast(p.text, p.surface) >= 7, `${hue}/${tint}`);
      assert.ok(contrast(p.text, p.panel) >= 7, `${hue}/${tint} en la barra`);
      assert.ok(contrast(p.textDim, p.surface) >= 4.5, `${hue}/${tint} secundario`);
    }
  }
});

test("el aspecto con el tema Carátula lleva sus columnas teñidas", () => {
  const appearance = { ...defaults().appearance, theme: "artwork" };
  const look = computeLook(appearance, { artColor: { hue: 0, sat: 50 } });
  assert.equal(look.vars["--panel"], artworkPalette({ hue: 0, sat: 50 }).panel);

  const plain = computeLook(defaults().appearance);
  assert.match(plain.vars["--panel"], /color-mix/, "los demás temas, translúcidas como siempre");
  assert.ok(THEMES.every((t) => !t.palette.panel));
});

// --- Mensajes de error -------------------------------------------------------

test("los errores técnicos no llegan a la pantalla", () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    assert.equal(friendlyError("yt-dlp fallo: ERROR: [youtube] abc: HTTP Error 403", "Genérico"), "Genérico");
    assert.equal(friendlyError(new TypeError("x is undefined"), "Genérico"), "Genérico");
    assert.equal(friendlyError("usuarios bloqueados", "Genérico"), "Genérico");
    assert.equal(friendlyError(""), "Algo no salió bien. Inténtalo de nuevo.");
  } finally {
    console.warn = quiet;
  }
});

test("los errores conocidos se explican", () => {
  assert.equal(friendlyError("ERROR: Video unavailable"), "Esa canción no está disponible en YouTube.");
  assert.match(friendlyError("Failed to fetch"), /conexión/);
  assert.match(friendlyError("Sign in to confirm your age"), /iniciar sesión/);
});

test("los mensajes escritos para el usuario pasan tal cual", () => {
  assert.equal(friendlyError("Ponle un nombre a la lista."), "Ponle un nombre a la lista.");
  assert.equal(
    friendlyError("No encontré nada que recomendar ahora mismo. ¿Hay conexión?"),
    "No encontré nada que recomendar ahora mismo. ¿Hay conexión?",
  );
});