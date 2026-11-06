import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioResolver } from '../src/js/audio-resolver.js';
import { createLatestSearch } from '../src/js/latest-search.js';
import { createBatchRenderer } from '../src/js/batch-render.js';
import { viewportLayout } from '../src/js/mobile-viewport.js';
import { Recovery } from '../src/js/recovery.js';

test('prefetch y reproducción comparten la resolución; calidad y renovación son independientes', async () => {
  const calls = []; let now = 0;
  const resolver = createAudioResolver({ now: () => now, ttl: 100, load: async (id, options) => {
    calls.push(options); return { id, title: 'Pista' };
  } });
  const [first, second] = await Promise.all([resolver.resolve('one'), resolver.resolve('one')]);
  assert.equal(calls.length, 1); assert.equal(first.cached, false); assert.equal(second.cached, true);
  await resolver.resolve('one', { quality: 'saver' });
  await resolver.resolve('one', { fresh: true });
  assert.equal(calls.length, 3); assert.equal(calls[1].quality, 'saver'); assert.equal(calls[2].fresh, true);
  now = 101; await resolver.resolve('one'); assert.equal(calls.length, 4);
});

test('un error no se almacena ni una pista distinta se acepta como resolución', async () => {
  let attempts = 0;
  const resolver = createAudioResolver({ load: async id => {
    if (++attempts === 1) throw new Error('offline');
    return { id: attempts === 2 ? 'other' : id };
  } });
  await assert.rejects(resolver.resolve('one'), /offline/);
  await assert.rejects(resolver.resolve('one'), /otra canción/);
  assert.equal((await resolver.resolve('one')).id, 'one');
});

test('una consulta nueva cancela todas las fuentes anteriores pero conserva las paralelas actuales', () => {
  const search = createLatestSearch(); const first = search.signal('uno');
  assert.equal(search.signal(' UNO '), first);
  const second = search.signal('dos'); assert.equal(first.aborted, true); assert.equal(second.aborted, false);
  search.cancel(); assert.equal(second.aborted, true); assert.equal(search.signal('dos').aborted, false);
});

test('las listas largas se dibujan en orden y cambiar de vista cancela filas pendientes', () => {
  const jobs = new Map(); let id = 0; const rows = [], progress = [];
  const renderer = createBatchRenderer({ schedule: fn => { jobs.set(++id, fn); return id; }, cancel: key => jobs.delete(key) });
  renderer.render([1,2,3,4,5], batch => rows.push(...batch), { size: 2, progress: done => progress.push(done) });
  assert.deepEqual(rows, [1,2]);
  const next = jobs.values().next().value; jobs.clear(); next();
  assert.deepEqual(rows, [1,2,3,4]);
  const stale = jobs.values().next().value;
  renderer.render([9], batch => rows.push(...batch)); stale();
  assert.deepEqual(rows, [1,2,3,4,9]); assert.deepEqual(progress, [2,4]); assert.equal(jobs.size, 0);
});

test('la barra de Safari no se confunde con el teclado y el viewport tiene altura válida', () => {
  assert.deepEqual(viewportLayout(800, 740), { height: 740, keyboard: false });
  assert.deepEqual(viewportLayout(800, 450), { height: 450, keyboard: true });
  assert.deepEqual(viewportLayout(800, undefined), { height: 800, keyboard: false });
});

test('pausar durante un reintento impide que su resultado vuelva al estado de reproducción', async () => {
  let finish; const states = [];
  const r = new Recovery({ retry: () => new Promise(resolve => { finish = resolve; }), waiting() {}, failed() {},
    online: () => true, stateChanged: state => states.push(state), timer: () => 1, cancel() {} });
  r.begin(45); r.playing(); const old = r.fail(); r.pause(); finish(true); await old;
  assert.equal(r.state, 'paused'); assert.equal(r.intent, false); assert.equal(r.position, 45);
  assert.deepEqual(states.slice(-2), ['recovering', 'paused']);
});
