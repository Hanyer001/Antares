import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../src/js/web-runtime.js', import.meta.url), 'utf8'))
  .replace(/import \{ API[^}]*\} from "\.\.\/config\.js";/, 'const API = "./api/", WEB_VERSION = "test";')
  .replace(/from ['"](\.\/[^'"]+)['"]/g, (_, path) => `from '${new URL('../src/js/' + path, import.meta.url).href}'`);
let serial = 0;
async function fixture() {
  const values = new Map();
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  globalThis.location = { href: 'http://192.168.1.139:4173/' };
  globalThis.window = new EventTarget();
  globalThis.document = { documentElement: { dataset: { platform: 'android' } } };
  const calls = [];
  let revision = 0, offline = false, settings = {}, pendingQuery;
  globalThis.fetch = async (url, options = {}) => {
    if (offline) throw new TypeError('offline');
    const command = new URL(url).pathname.split('/').at(-1);
    const args = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), command, args, headers: options.headers, signal: options.signal });
    if (pendingQuery && new URL(url).searchParams.get('q') === pendingQuery) {
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    const result = new URL(url).pathname.includes('/track/') ? { id: command, title: 'Pista' } : command === 'songs' ? [] : { value: command === 'get_settings' ? settings : null, revision: command === 'get_settings' ? revision : ++revision };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const module = await import('data:text/javascript;base64,' + Buffer.from(source + `\n// instance ${serial++}`).toString('base64'));
  return { ...module, values, calls, offline: value => { offline = value; }, settings: value => { settings = value; }, hold: query => { pendingQuery = query; } };
}
test('el adaptador genera una clave privada y transmite revisiones en orden', async () => {
  const f = await fixture();
  await f.rpc('get_settings', {});
  await Promise.all([f.rpc('create_playlist', { name: 'Uno' }), f.rpc('create_playlist', { name: 'Dos' })]);
  assert.match(f.calls[0].headers['X-Antares-Account'], /^[a-f0-9]{64}$/);
  assert.equal(f.calls[1].headers['X-Antares-Revision'], '0');
  assert.equal(f.calls[2].headers['X-Antares-Revision'], '1');
  assert.equal(f.calls[2].args.name, 'Dos');
});
test('el perfil seleccionado acompaña cada petición y la búsqueda móvil usa el catálogo musical', async () => {
  const f = await fixture();
  await f.rpc('switch_user', { id: 'u123' });
  await f.rpc('get_settings', {});
  assert.equal(f.calls[1].headers['X-Antares-Profile'], 'u123');
  await f.runtime.core.invoke('search_tracks', { query: 'Música', limit: 20 });
  assert.match(f.calls.at(-1).url, /v1\/songs\?q=M%C3%BAsica&limit=20$/);
});
test('una escucha sin red se conserva y se reenvía con el mismo identificador', async () => {
  const f = await fixture();
  f.offline(true);
  await assert.rejects(f.runtime.core.invoke('record_listen', { track: { id: 'abcdefghijk' }, listened: 60, ended: false }));
  const pending = JSON.parse(f.values.get('antares.web.outbox'));
  assert.equal(pending.length, 1);
  f.offline(false);
  await f.flushPendingEvents();
  assert.equal(f.calls.at(-1).args.eventId, pending[0].args.eventId);
  assert.deepEqual(JSON.parse(f.values.get('antares.web.outbox')), []);
});

test('ahorro de datos y prefetch se reutilizan sin leer ajustes por cada canción', async () => {
  const f = await fixture();
  f.settings({ playback: { quality: 'saver' } }); await f.rpc('get_settings', {});
  await f.runtime.core.invoke('prefetch_audio_url', { query: 'abcdefghijk' });
  const result = await f.runtime.core.invoke('get_audio_url', { query: 'abcdefghijk' });
  assert.match(result.url, /audio\/abcdefghijk\?saver=true$/);
  assert.equal(result.cached, true);
  assert.equal(f.calls.filter(call => call.command === 'get_settings').length, 1);
  assert.equal(f.calls.filter(call => call.command === 'abcdefghijk').length, 1);
  await f.runtime.core.invoke('get_audio_url', { query: 'abcdefghijk', fresh: true });
  assert.match(f.calls.at(-1).url, /saver=true&fresh=true$/);
  await f.runtime.core.invoke('save_settings', { value: { playback: { quality: 'high' } } });
  const high = await f.runtime.core.invoke('get_audio_url', { query: 'abcdefghijk' });
  assert.equal(new URL(high.url).searchParams.has('saver'), false);
});

test('al iniciar una consulta se cancela la petición anterior aunque la nueva salga de caché', async () => {
  const f = await fixture();
  f.hold('uno');
  const previous = f.runtime.core.invoke('search_tracks', { query: 'uno', limit: 20 });
  const cancelled = assert.rejects(previous, { name: 'AbortError' });
  await f.runtime.core.invoke('begin_search', { query: 'dos' });
  await cancelled;
  assert.equal(f.calls[0].signal.aborted, true);
});
