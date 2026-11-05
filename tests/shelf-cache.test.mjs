import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShelfCache } from '../src/js/shelf-cache.js';
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

test('una recomendación antigua que termina tarde no repone la música anterior', async () => {
  const cache = createShelfCache();
  const old = deferred();
  const pending = cache.generate('mix', () => old.promise);
  cache.entries.clear();
  await cache.generate('mix', async () => ({ tracks: [{ id: 'musica-elegida-ahora' }] }));
  old.resolve({ tracks: [{ id: 'prueba-50-cent' }] });
  await pending;
  assert.equal(cache.entries.get('mix').tracks[0].id, 'musica-elegida-ahora');
});

test('cambiar escuchas invalida una sola vez y no pierde cambios durante una recarga', async () => {
  const cache = createShelfCache();
  await cache.generate('mix', async () => ({ tracks: ['antes'] }));
  cache.invalidate(); cache.invalidate();
  assert.equal(cache.needsRefresh, true);
  assert.deepEqual(cache.entries.get('mix').tracks, ['antes']);
  assert.equal(cache.consumeInvalidation(), true);
  assert.equal(cache.consumeInvalidation(), false);
  const later = deferred();
  const loading = cache.generate('mix', () => later.promise);
  cache.invalidate();
  later.resolve({ tracks: ['actualizadas'] }); await loading;
  assert.equal(cache.needsRefresh, true);
});

test('un fallo descartado no sustituye resultados nuevos por un error', async () => {
  const cache = createShelfCache(), old = deferred();
  const pending = cache.generate('because:a', () => old.promise);
  cache.entries.clear();
  await cache.generate('because:a', async () => ({ tracks: ['actuales'] }));
  old.reject(Error('respuesta vieja')); await pending;
  assert.equal(cache.entries.get('because:a').state, 'ready');
});
