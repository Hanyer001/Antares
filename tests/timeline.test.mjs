import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeline, keyboardSeek } from '../src/js/timeline.js';

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
