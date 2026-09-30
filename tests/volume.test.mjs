// Pruebas de la curva del volumen (volume.js, sin DOM ni Tauri).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { gainFor } from "../src/js/volume.js";

const db = (gain) => 20 * Math.log10(gain);

test("los extremos: 0 es silencio y 100 % no toca nada", () => {
  assert.equal(gainFor(0), 0);
  assert.equal(gainFor(1), 1);
});

test("bajar el deslizador se oye: 50 % es bastante más flojo, no solo −6 dB", () => {
  assert.ok(db(gainFor(0.8)) < -5, "80 % ya baja algo");
  assert.ok(db(gainFor(0.5)) < -15, "50 % baja de verdad");
  assert.ok(db(gainFor(0.2)) < -35, "20 % es bajito");
});

test("sube siempre al subir el deslizador", () => {
  for (let v = 0; v < 1; v += 0.05) assert.ok(gainFor(v + 0.05) > gainFor(v));
});

test("valores raros no rompen nada", () => {
  assert.equal(gainFor(-1), 0);
  assert.equal(gainFor(2), 1);
  assert.equal(gainFor(Number.NaN), 0);
});
