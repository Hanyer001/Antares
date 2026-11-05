export function delayedFlag(notify, { schedule = setTimeout, cancel = clearTimeout, delay = 150 } = {}) {
  let generation = 0, timer = null;
  return busy => {
    const mine = ++generation;
    if (timer !== null) cancel(timer);
    timer = null;
    notify(false);
    if (busy) timer = schedule(() => { if (mine === generation) { timer = null; notify(true); } }, delay);
  };
}
export function playbackPhase(state, phase) {
  if (state === 'busy') return ['preparing','buffering','reconnecting'].includes(phase) ? phase : 'preparing';
  return state === 'error' ? 'error' : state === 'playing' ? 'playing' : 'paused';
}
export const PHASE_TEXT = {
  preparing: 'Preparando la canción…', buffering: 'Esperando audio para continuar…',
  reconnecting: 'Sin conexión. Esperando reconectar…', error: 'No se pudo reproducir. Reintenta o cambia de canción.',
  playing: '', paused: '',
};
