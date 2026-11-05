import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientQueue } from '../src/js/ambient-queue.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('una descarga antigua no aparece después de cambiar de canción', async () => {
  const slow = deferred(), shown = [];
  const set = ambientQueue({ load: u => u === 'old' ? slow.promise : Promise.resolve(), present: u => shown.push(u) });
  const done = set('old'); set('latest'); slow.resolve(); await done;
  assert.deepEqual(shown, ['latest']);
});
test('una portada rápida no espera al timeout de una descarga anterior', async () => {
  const slow = deferred(), shown = [];
  const set = ambientQueue({ load: u => u === 'slow' ? slow.promise : Promise.resolve(), present: u => shown.push(u) });
  const done = set('slow'); await turn(); set('fast'); await done;
  assert.deepEqual(shown, ['fast']);
  slow.resolve(); await turn(); assert.deepEqual(shown, ['fast']);
});
test('cambios durante el fundido se agrupan y no superponen animaciones', async () => {
  const fade = deferred(), shown = [];
  const set = ambientQueue({ load: async () => {}, present: async u => { shown.push(u); if (u === 'a') await fade.promise; } });
  const done = set('a'); await turn(); set('b'); set('c'); fade.resolve(); await done;
  assert.deepEqual(shown, ['a', 'c']);
});
test('volver a la portada inicial durante una transición la restaura', async () => {
  const fade = deferred(), shown = [];
  const set = ambientQueue({ load: async () => {}, present: async u => { shown.push(u); if (u === 'b') await fade.promise; } });
  await set('a'); const done = set('b'); await turn(); set('a'); fade.resolve(); await done;
  assert.deepEqual(shown, ['a', 'b', 'a']);
});
test('un error conserva la anterior y permite reintentar', async () => {
  const shown = []; let failed = true;
  const set = ambientQueue({ load: async u => { if (u === 'b' && failed) throw Error(); }, present: u => shown.push(u) });
  await set('a'); await set('b'); assert.deepEqual(shown, ['a']);
  failed = false; await set('b'); assert.deepEqual(shown, ['a','b']);
});
test('limpiar durante una descarga no resucita la imagen pendiente', async () => {
  const slow = deferred(), shown = [];
  const set = ambientQueue({ load: () => slow.promise, present: u => shown.push(u) });
  const done = set('a'); set(null); slow.resolve(); await done;
  assert.deepEqual(shown, [null]);
});
test('limpiar durante un fundido impide que su final reactive el fondo', async () => {
  const fade = deferred(), shown = [];
  const set = ambientQueue({ load: async () => {}, present: async u => { shown.push(u); if (u) await fade.promise; } });
  const done = set('a'); await turn(); set(null); fade.resolve(); await done;
  assert.deepEqual(shown, ['a', null]);
  await set('b'); // La promesa ya resuelta permite continuar tras limpiar.
  assert.deepEqual(shown, ['a', null, 'b']);
});
