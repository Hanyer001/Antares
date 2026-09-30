// Géneros, atajos y validación de preferencias.
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { detectGenres, GENRES, genresOf, tracksOfGenre } from "../src/js/genres.js";
import { comboFromEvent, comboLabel, conflicts, hasModifier, matches } from "../src/js/keys.js";
import {
  defaults,
  GLOBAL_SHORTCUTS,
  LOCAL_SHORTCUTS,
  sanitize,
  SHELF_IDS,
  TAB_IDS,
  withPath,
} from "../src/js/prefs-schema.js";

const track = (title, uploader, listened_secs = 100) => ({ id: title, title, uploader, listened_secs });

// --- Géneros ---------------------------------------------------------------

test("un género por artista o por palabra del título", () => {
  assert.deepEqual(genresOf(track("Nirvana - Come As You Are", "Nirvana")), ["rock"]);
  assert.ok(genresOf(track("MILO J - OLIMPO", "MILO J")).includes("trap-latino"));
  assert.deepEqual(genresOf(track("Corrido del Sol", "Alguien")), ["regional-mexicano"]);
  assert.deepEqual(genresOf(track("Una canción", "Nadie conocido")), []);
});

test("las palabras cuentan enteras: «Rockstar» no es rock", () => {
  assert.deepEqual(genresOf(track("Rockstar", "Nadie")), []);
  assert.deepEqual(genresOf(track("Sweet Home (Rock Version)", "Nadie")), ["rock"]);
});

test("tildes y mayúsculas dan igual", () => {
  assert.ok(genresOf(track("x", "ARCANGEL")).includes("reggaeton"));
  assert.ok(genresOf(track("x", "Arcángel")).includes("reggaeton"));
});

test("un remix de reggaetón no se cuela en electrónica", () => {
  assert.ok(!genresOf(track("Yan Block - 444 Remix", "Yan Block")).includes("electronica"));
});

test("detectar tus géneros por tiempo escuchado", () => {
  const library = [
    track("A", "Yan Block", 900),
    track("B", "Milo J", 800),
    track("C", "Duki", 500),
    track("D", "Nirvana", 400),
    track("E", "Karol G", 300),
    track("F", "Desconocido", 5000),
  ];
  const found = detectGenres(library);

  assert.equal(found[0].id, "trap-latino");
  assert.ok(found.some((g) => g.id === "rock"));
  assert.ok(found[0].share > found[1].share);
  assert.equal(found[0].tracks[0].uploader, "Yan Block", "de la más escuchada a la menos");
  assert.ok(found.every((g) => g.share >= 0.12));
});

test("sin nada reconocible no hay géneros", () => {
  assert.deepEqual(detectGenres([]), []);
  assert.deepEqual(detectGenres([track("x", "Nadie")]), []);
});

test("las pistas de un género", () => {
  const library = [track("A", "Nirvana"), track("B", "Duki")];
  assert.deepEqual(tracksOfGenre(library, "rock").map((t) => t.id), ["A"]);
});

test("cada género tiene nombre, búsqueda y algo con qué reconocerlo", () => {
  const ids = new Set();
  for (const g of GENRES) {
    assert.ok(g.name && g.query, g.id);
    assert.ok(g.artists.length + g.keywords.length > 0, g.id);
    assert.ok(!ids.has(g.id), `repetido: ${g.id}`);
    ids.add(g.id);
  }
});

// --- Teclas ----------------------------------------------------------------

const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("una pulsación se escribe como combinación", () => {
  assert.equal(comboFromEvent(key("Space")), "Space");
  assert.equal(comboFromEvent(key("KeyL", { ctrlKey: true, altKey: true })), "Ctrl+Alt+KeyL");
  assert.equal(comboFromEvent(key("ArrowRight", { shiftKey: true })), "Shift+ArrowRight");
  assert.equal(comboFromEvent(key("ControlLeft", { ctrlKey: true })), null, "solo un modificador");
  assert.ok(matches(key("KeyM"), "KeyM"));
  assert.ok(!matches(key("KeyM", { ctrlKey: true }), "KeyM"));
  assert.ok(!matches(key("KeyM"), ""));
});

test("las combinaciones se enseñan en español", () => {
  assert.equal(comboLabel("Ctrl+Alt+ArrowRight"), "Ctrl + Alt + →");
  assert.equal(comboLabel("Shift+Space"), "Mayús + Espacio");
  assert.equal(comboLabel("KeyM"), "M");
  assert.equal(comboLabel(""), "Sin atajo");
});

test("los atajos globales necesitan un modificador de verdad", () => {
  assert.ok(hasModifier("Ctrl+KeyA"));
  assert.ok(!hasModifier("Shift+KeyA"));
  assert.ok(!hasModifier("F5"));
});

test("atajos repetidos", () => {
  assert.deepEqual(conflicts({ a: "KeyA", b: "KeyB", c: "KeyA", d: "" }), { a: "c", c: "a" });
  assert.deepEqual(conflicts({ a: "", b: "" }), {});
});

test("los atajos de serie no se pisan entre sí", () => {
  assert.deepEqual(conflicts(LOCAL_SHORTCUTS), {});
  assert.deepEqual(conflicts(GLOBAL_SHORTCUTS), {});
  for (const combo of Object.values(GLOBAL_SHORTCUTS)) assert.ok(hasModifier(combo), combo);
});

// --- Esquema: orden, subconjunto y combinación -------------------------------

test("un orden guarda lo válido y completa lo que falta", () => {
  const clean = sanitize({ layout: { tabOrder: ["queue", "queue", "inventada", "home"] } });
  assert.deepEqual(clean.layout.tabOrder.slice(0, 2), ["queue", "home"]);
  assert.deepEqual([...clean.layout.tabOrder].sort(), [...TAB_IDS].sort());
  assert.deepEqual(sanitize({}).home.shelfOrder, SHELF_IDS);
});

test("un subconjunto solo admite valores conocidos y sin repetir", () => {
  const clean = sanitize({ home: { genres: ["rock", "rock", "polka"] }, layout: { hiddenTabs: "todas" } });
  assert.deepEqual(clean.home.genres, ["rock"]);
  assert.deepEqual(clean.layout.hiddenTabs, []);
});

test("una combinación mal escrita vuelve a la de serie; vacía es «sin atajo»", () => {
  const clean = sanitize({
    shortcuts: { local: { mute: "Ctrl+Mayus+M", like: "", playPause: "Ctrl+Space" } },
  });
  assert.equal(clean.shortcuts.local.mute, LOCAL_SHORTCUTS.mute);
  assert.equal(clean.shortcuts.local.like, "");
  assert.equal(clean.shortcuts.local.playPause, "Ctrl+Space");
});

test("los valores por defecto no comparten arrays con el esquema", () => {
  const a = defaults();
  a.layout.tabOrder.reverse();
  assert.deepEqual(defaults().layout.tabOrder, TAB_IDS);
});

test("cambiar un atajo concreto por su ruta", () => {
  const next = withPath(defaults(), "shortcuts.global.show", "Ctrl+Shift+KeyA");
  assert.equal(next.shortcuts.global.show, "Ctrl+Shift+KeyA");
  assert.equal(next.shortcuts.global.playPause, GLOBAL_SHORTCUTS.playPause);
});
