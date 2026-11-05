// En WebKitGTK/Wayland minimizar no siempre cambia document.hidden.
// Sin foco se detienen efectos decorativos y el progreso se pinta a 1 Hz.
// Los eventos del reproductor y la música siguen funcionando normalmente.
import { shouldPaintProgress } from './visual-policy.js';
const root = document.documentElement;
const mobile = root.dataset.platform === "android";
let focused = document.hasFocus();
const listeners = new Set();
export const visualsActive = () => !document.hidden && (mobile || focused);
function refresh() {
  root.toggleAttribute('data-app-idle', !visualsActive());
  for (const callback of listeners) callback(visualsActive());
}
const focus = value => { if (focused !== value) { focused = value; refresh(); } };
window.addEventListener('focus', () => focus(true));
window.addEventListener('blur', () => focus(false));
document.addEventListener('visibilitychange', refresh);
window.__TAURI__?.window?.getCurrentWindow().onFocusChanged(({payload}) => focus(payload)).catch(() => {});
export function onVisualActivity(callback) { listeners.add(callback); }
export function visualTask(callback) {
  let last = -Infinity, args = [];
  const run = (...next) => {
    args = next;
    const time = performance.now();
    if (!shouldPaintProgress({hidden:document.hidden, focused:mobile || focused, time, last})) return;
    last = time;
    callback(...args);
  };
  onVisualActivity(active => { if (active) { last = -Infinity; run(...args); } });
  return run;
}
refresh();
