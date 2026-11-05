import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackSource } from '../src/js/audio-source.js';

test('Linux conserva la URL firmada completa en la ruta del proxy local', () => {
  const url = 'https://rr1.googlevideo.com/videoplayback?sig=a+b%2Fc&x=ñ&range=0-';
  const base = 'http://127.0.0.1:43210/session-key';
  const actual = playbackSource(url, base, () => assert.fail('no usar stream en Linux'));
  assert.equal(new URL(actual).origin, 'http://127.0.0.1:43210');
  assert.equal(new URL(actual).search, '');
  assert.equal(decodeURIComponent(actual.slice(base.length + 1)), url);
});

test('sin proxy HTTP se conserva el protocolo de escritorio existente', () => {
  const calls = [];
  assert.equal(playbackSource('https://audio.test/a', null, (...args) => {
    calls.push(args); return 'stream://localhost/encoded';
  }), 'stream://localhost/encoded');
  assert.deepEqual(calls, [['https://audio.test/a', 'stream']]);
});
