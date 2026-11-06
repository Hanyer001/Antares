import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Importa el código fuente web con sus módulos compartidos, sin generar dist.
const root = new URL("../", import.meta.url);
const source = (await readFile(new URL("web/playback.js", root), "utf8"))
  .replaceAll('"./shared/', '"' + new URL("src/js/", root).href);
globalThis.window = new EventTarget();
globalThis.location = { search: "" };
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
class Element extends EventTarget {
  attrs = new Map();
  value = "0";
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key); }
  append() {}
  replaceChildren() {}
}
globalThis.document = { createElementNS: () => new Element() };
const { createPlayback } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

function setup() {
  const audio = new Element();
  Object.assign(audio, { paused: true, ended: false, readyState: 0, duration: NaN, currentTime: 0 });
  audio.pause = () => { audio.paused = true; audio.dispatchEvent(new Event("pause")); };
  audio.play = async () => { audio.paused = false; audio.dispatchEvent(new Event("playing")); };
  const slider = new Element(), elapsed = new Element(), duration = new Element();
  const saved = [], statuses = [];
  let ended = 0;
  const player = createPlayback({ audio, slider, elapsed, duration, toggle: new Element(), diagnostics: new Element(),
    audioUrl: id => `/audio/${id}`, onTrack() {}, onEnd: () => ended++,
    onSave: (track, position) => saved.push({ track, position }), status: text => statuses.push(text), showRetry() {} });
  return { player, audio, slider, elapsed, duration, saved, statuses, ended: () => ended };
}
const song = { id: "abcdefghijk", title: "Pista de prueba", duration: 154 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("restaurar no reproduce y conserva la posición hasta leer metadatos", () => {
  const { player, audio, elapsed } = setup();
  player.load(song, 20);
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(player.snapshot().position, 20);
  assert.equal(audio.paused, true);
  audio.readyState = 1; audio.duration = 154;
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 20);
  assert.equal(elapsed.textContent, "0:20");
  player.pause();
});

test("la estimación de Safari no altera el fin real ni el salto de pista", () => {
  const fixture = setup();
  const { player, audio, duration, slider } = fixture;
  player.load(song);
  audio.readyState = 1; audio.duration = 550;
  audio.dispatchEvent(new Event("durationchange"));
  assert.equal(duration.textContent, "2:34");
  slider.value = "80"; slider.dispatchEvent(new Event("change"));
  assert.equal(audio.currentTime, 80);
  audio.currentTime = 154; audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(fixture.ended(), 0);
  audio.ended = true; audio.dispatchEvent(new Event("ended"));
  assert.equal(fixture.ended(), 1);
  player.pause();
});

test("pausar cancela un inicio pendiente sin disparar recuperación", async () => {
  const { player, audio, statuses } = setup();
  let reject;
  audio.play = () => new Promise((_, fail) => { reject = fail; });
  player.start(song);
  player.pause();
  reject(Object.assign(new Error("abort"), { name: "AbortError" }));
  await tick();
  assert.equal(player.isActive(), false);
  assert.equal(statuses.at(-1), "");
});

test("un fallo renueva la fuente y recupera la posición actual", async () => {
  const { player, audio } = setup();
  player.start(song); await tick();
  audio.readyState = 1; audio.duration = 154; audio.currentTime = 24;
  audio.dispatchEvent(new Event("timeupdate"));
  audio.dispatchEvent(new Event("error")); await tick();
  audio.currentTime = 0;
  audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(audio.currentTime, 24);
  assert.equal(player.snapshot().position, 24);
  player.pause();
});
