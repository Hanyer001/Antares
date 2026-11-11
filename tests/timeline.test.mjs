import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeline, keyboardSeek, mediaDuration, passedCatalogEnd } from '../src/js/timeline.js';

test('Safari conserva una duración de catálogo válida frente a estimaciones exageradas', () => {
  assert.equal(mediaDuration(550, 154, true), 154);
  assert.equal(mediaDuration(301, 151, true), 151);
  assert.equal(mediaDuration(153.9, 154, true), 153.9);
  assert.equal(mediaDuration(NaN, 154, true), 154);
  assert.equal(mediaDuration(550, 154, false), 550);
  assert.equal(mediaDuration(90, null, true), 90);
});

test('duración desconocida o inválida nunca habilita saltos', () => {
  for (const duration of [null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(timeline(30, duration), { duration: null, current: 0, ratio: 0 });
    assert.equal(keyboardSeek('End', 30, duration), null);
  }
});
test('el progreso se limita a la canción, incluidos metadatos inconsistentes', () => {
  assert.deepEqual(timeline(400, 200), { current: 200, duration: 200, ratio: 1 });
  assert.equal(timeline(-8, 200).ratio, 0);
  assert.equal(timeline(NaN, 200).ratio, 0);
});
test('teclado salta segundos constantes independientemente de la duración', () => {
  for (const duration of [60, 300, 7200]) {
    assert.equal(keyboardSeek('ArrowRight', 10, duration), 15 / duration);
    assert.equal(keyboardSeek('PageUp', 10, duration), 20 / duration);
    assert.equal(keyboardSeek('Home', 10, duration), 0);
    assert.equal(keyboardSeek('End', 10, duration), 1);
  }
  assert.equal(keyboardSeek('ArrowLeft', 2, 60), 0);
  assert.equal(keyboardSeek('ArrowRight', 59, 60), 1);
  assert.equal(keyboardSeek('Tab', 10, 60), null);
});

test('el final de respaldo requiere una duración inconsistente y haber pasado el final', () => {
  assert.equal(passedCatalogEnd(151, 301, 151), false);
  assert.equal(passedCatalogEnd(152, 301, 151), true);
  assert.equal(passedCatalogEnd(154.5, Infinity, 154), false);
  assert.equal(passedCatalogEnd(155.1, Infinity, 154), true);
  assert.equal(passedCatalogEnd(155.1, 550, 154), true);
  assert.equal(passedCatalogEnd(155.1, 155, 154), false);
  assert.equal(passedCatalogEnd(200, Infinity, null), false);
});
