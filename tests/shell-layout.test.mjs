import { test } from "node:test";
import assert from "node:assert/strict";
import { shellLayout } from "../src/js/shell-layout.js";

test("el escritorio amplio respeta los anchos preferidos y reserva contenido", () => {
  assert.deepEqual(shellLayout(1280), { icons: false, navigation: 236, context: 360, docked: true });
  assert.equal(shellLayout(1280, { sidebarWidth: 360, nowplayingWidth: 560 }).docked, false);
});
test("el panel pasa a superpuesto antes de comprimir la biblioteca", () => {
  assert.equal(shellLayout(1080).docked, true);
  assert.equal(shellLayout(1079).docked, false);
  assert.equal(shellLayout(980).icons, true);
  assert.equal(shellLayout(1040).icons, false);
});
test("navegación de iconos explícita se conserva en ventanas amplias", () => {
  assert.equal(shellLayout(1600, { sidebar: "icons" }).navigation, 68);
});
test("plegar y ampliar no modifica las preferencias recibidas", () => {
  const prefs = Object.freeze({ sidebar: "full", sidebarWidth: 280, nowplayingWidth: 420 });
  assert.equal(shellLayout(980, prefs).navigation, 68);
  assert.equal(shellLayout(1600, prefs).navigation, 280);
  assert.equal(shellLayout(1600, prefs).context, 420);
});
test("los anchos inválidos no producen columnas negativas", () => {
  assert.equal(shellLayout(0).docked, false);
  assert.equal(shellLayout(NaN).docked, true);
  assert.equal(shellLayout(1500, {sidebarWidth: -10, nowplayingWidth: 900}).navigation, 180);
  assert.equal(shellLayout(1500, {nowplayingWidth: 900}).context, 560);
});
