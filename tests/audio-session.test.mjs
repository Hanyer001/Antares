import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configurePlaybackSession, resumeAudioContext } from '../src/js/audio-session.js';

test('declara música en plataformas con Audio Session sin romper las que carecen de ella', () => {
  const browser = { audioSession: { type: 'auto' } };
  assert.equal(configurePlaybackSession(browser), true);
  assert.equal(browser.audioSession.type, 'playback');
  assert.equal(configurePlaybackSession({}), false);
  assert.equal(configurePlaybackSession({ get audioSession() { throw Error('unavailable'); } }), false);
});
test('reanuda contextos suspendidos o interrumpidos sin crear otro contexto', async () => {
  for (const state of ['suspended', 'interrupted']) {
    let calls = 0;
    const context = { state, async resume() { calls++; this.state = 'running'; } };
    assert.equal(await resumeAudioContext(context), true);
    assert.equal(calls, 1);
    assert.equal(await resumeAudioContext(context), true);
    assert.equal(calls, 1);
  }
  assert.equal(await resumeAudioContext({ state: 'closed', resume() { assert.fail(); } }), false);
  assert.equal(await resumeAudioContext({ state: 'interrupted', async resume() { throw Error('blocked'); } }), false);
});
