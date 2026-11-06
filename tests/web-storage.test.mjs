import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/js/web-storage.js', import.meta.url), 'utf8');
let serial = 0;
async function fixture() {
  const values = new Map();
  globalThis.indexedDB = undefined;
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const module = await import('data:text/javascript;base64,' + Buffer.from(source + `\n// instance ${serial++}`).toString('base64'));
  return { ...module, values };
}
test('migra la sesión del prototipo conservando posición y modos sin borrar el respaldo', async () => {
  const f = await fixture();
  const session = { queue: { items: [{ id: 'abcdefghijk' }], index: 0, shuffled: true }, track: { id: 'abcdefghijk' }, time: 24, repeat: 'all', savedAt: 1 };
  f.values.set('antares.web.session', JSON.stringify(session));
  await f.hydrateSession();
  assert.deepEqual(f.readCachedSession('antares.session'), session);
  assert.ok(f.values.has('antares.web.session'));
});
test('los perfiles no heredan la cola principal y una restauración sustituye la memoria', async () => {
  const f = await fixture();
  f.values.set('antares.web.profile', 'u123');
  f.values.set('antares.web.session', JSON.stringify({ time: 50 }));
  await f.hydrateSession();
  assert.equal(f.readCachedSession('antares.session.u123'), null);
  f.persistSession('antares.session.u123', { time: 10, savedAt: 1 });
  f.persistSession('antares.session.u123', { time: 40, savedAt: 2 });
  assert.equal(f.readCachedSession('antares.session.u123').time, 40);
});
