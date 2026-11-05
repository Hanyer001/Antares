import { delayedFlag, playbackPhase, PHASE_TEXT } from './loading-policy.js';
const root = document.documentElement;
const desktop = root.dataset.platform !== 'android';
let busy = false, active = false, ready = false, error = '';
const $ = id => document.getElementById(id);
function render() {
  if (!desktop) return;
  const waiting = active && busy;
  const skeleton = waiting && ready;
  $('results').dataset.searchState = waiting ? 'loading' : 'ready';
  $('results-list').hidden = skeleton;
  $('results-list').setAttribute('aria-busy', String(waiting));
  $('search-skeleton').hidden = !skeleton;
  $('search-feedback').hidden = !active || (!busy && !error);
  $('search-status').textContent = busy ? 'Buscando canciones…' : error;
  $('search-retry').hidden = busy || !error;
}
const delay = delayedFlag(value => { ready = value; render(); });
export function setSearchView(visible) { active = visible; render(); }
export function setSearchBusy(value, message = '') {
  busy = value; error = value ? '' : message;
  if (desktop) delay(value);
}
export function setPlaybackPhase(state, phase) {
  if (!desktop) return;
  const value = playbackPhase(state, phase), text = PHASE_TEXT[value];
  root.dataset.playbackPhase = value;
  for (const id of ['playback-status','pbar-status']) {
    const node = $(id); if (!node) continue;
    if (node.textContent !== text) node.textContent = text;
    node.hidden = !text;
    node.title = text;
    node.dataset.tone = value === 'error' ? 'error' : 'busy';
  }
  $('engine').title = text || (value === 'playing' ? 'Reproduciendo' : 'En pausa');
}
