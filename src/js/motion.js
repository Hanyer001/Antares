import { motionTiming, lyricScrollBehavior } from './motion-policy.js';
import { visualsActive, onVisualActivity } from './visual-activity.js';
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Map();
export const motionEnabled = () => motionTiming(root.dataset.motion, reduced.matches).navigation > 0;
export const lyricsScroll = (distance, height) => lyricScrollBehavior(root.dataset.motion, reduced.matches || root.hasAttribute('data-energy-saver'), distance, height);
function stop() { for (const animation of running.values()) animation.cancel(); running.clear(); }
reduced.addEventListener('change', () => { if (!motionEnabled()) stop(); });
new MutationObserver(() => { if (!motionEnabled() || root.classList.contains('is-resizing')) stop(); }).observe(root, {attributes:true,attributeFilter:['data-motion','class']});
window.addEventListener('resize',stop);
onVisualActivity(active => { if (!active) stop(); });
function visibility() {
  root.toggleAttribute('data-app-hidden', document.hidden);
  if (document.hidden) stop();
}
document.addEventListener('visibilitychange', visibility);
visibility();

/** Solo presentación: no espera para ejecutar acciones ni reconstruye el DOM. */
export function enterSurface(node, kind = 'navigation') {
  if (!node || !visualsActive() || root.dataset.platform === 'android' || node.hidden || node.closest('[hidden]')) return;
  // Navegar ya seleccionó una vista visible. Leer su geometría aquí fuerza
  // layout dentro del clic; el navegador puede calcularlo junto al pintado.
  if (kind !== 'navigation' && !node.getClientRects().length) return;
  const duration = motionTiming(root.dataset.motion, reduced.matches)[kind];
  if (!duration) return;
  const previous = running.get(node);
  const current = previous ? getComputedStyle(node) : null;
  const from = current ? {opacity:current.opacity,transform:current.transform} : {opacity:0,transform:`translateY(${kind === 'panel' ? 6 : 8}px)`};
  previous?.cancel();
  const animation = node.animate([from,{opacity:1,transform:'translateY(0)'}], {duration,easing:'cubic-bezier(.2,.8,.2,1)'});
  running.set(node,animation);
  animation.finished.catch(() => {}).finally(() => { if (running.get(node) === animation) running.delete(node); });
}
