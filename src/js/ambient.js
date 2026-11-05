import { ambientQueue } from './ambient-queue.js';
import { visualsActive, onVisualActivity } from './visual-activity.js';

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let artwork = null, wallpaper = null, surfaces = null;
const decoded = new Map();
const still = () => !visualsActive() || reduced.matches || ['none', 'reduced'].includes(root.dataset.motion);

function load(url) {
  if (!decoded.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      const timeout = setTimeout(() => { img.onload = img.onerror = null; reject(Error('timeout')); }, 5000);
      const finish = (error) => { clearTimeout(timeout); img.onload = img.onerror = null; error ? reject(error) : resolve(); };
      img.onload = () => img.decode().then(() => finish(), finish);
      img.onerror = () => finish(Error('image'));
      img.src = url;
    });
    decoded.set(url, promise);
    promise.catch(() => { if (decoded.get(url) === promise) decoded.delete(url); });
    if (decoded.size > 24) decoded.delete(decoded.keys().next().value);
  }
  return decoded.get(url);
}

function surface(host) {
  const layers = [0, 1].map(() => {
    const layer = document.createElement('div');
    layer.className = 'ambient-layer'; layer.style.opacity = '0'; host.append(layer);
    return layer;
  });
  host.classList.add('ambient-managed');
  let active = 0, generation = 0, animations = [];
  const finish = () => animations.forEach(a => a.finish());
  const set = ambientQueue({ load, async present(url, { immediate = false } = {}) {
    const mine = ++generation;
    animations.forEach(a => a.cancel()); animations = [];
    if (!url) {
      for (const layer of layers) { layer.style.opacity = '0'; layer.style.backgroundImage = 'none'; }
      return;
    }
    const old = layers[active], next = layers[1 - active];
    // JSON protege comillas, barras y saltos de línea de las URL en CSS.
    next.style.backgroundImage = `url(${JSON.stringify(url)})`;
    const duration = immediate || still() || host.getClientRects().length === 0 ? 0 : 600;
    next.style.opacity = '1'; old.style.opacity = '0';
    if (duration) {
      animations = [next.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'cubic-bezier(.2,0,0,1)' }),
        old.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'cubic-bezier(.2,0,0,1)' })];
      await Promise.allSettled(animations.map(a => a.finished));
    }
    if (mine !== generation) return;
    old.style.backgroundImage = 'none'; active = 1 - active; animations = [];
  }});
  return { set, finish };
}

function refresh() {
  if (!surfaces) return;
  if (document.hidden) { surfaces.background?.finish(); surfaces.bar?.finish(); surfaces.sidebar?.finish(); return; }
  const mode = root.hasAttribute('data-focus') ? 'artwork' : root.dataset.background;
  const background = mode === 'artwork' ? artwork : mode === 'image' ? wallpaper : null;
  surfaces.background?.set(background);
  surfaces.sidebar?.set(background);
  surfaces.bar?.set(root.dataset.barStyle === 'artwork' ? artwork : null);
  if (still()) { surfaces.background?.finish(); surfaces.bar?.finish(); surfaces.sidebar?.finish(); }
}

function init() {
  if (surfaces || root.dataset.platform === 'android') return;
  const backdrop = document.querySelector('.backdrop'), bar = document.getElementById('playerbar');
  const host = bar && document.createElement('div');
  if (host) { host.className = 'pbar__ambient'; host.setAttribute('aria-hidden', 'true'); bar.prepend(host); bar.classList.add('ambient-managed'); }
  const sidebar = document.querySelector('.sidebar'), navigation = sidebar && document.createElement('div');
  if (navigation) { navigation.className = 'sidebar__ambient'; navigation.setAttribute('aria-hidden','true'); sidebar.prepend(navigation); sidebar.classList.add('ambient-sidebar'); }
  surfaces = { background: backdrop && surface(backdrop), bar: host && surface(host), sidebar: navigation && surface(navigation) };
  new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-background','data-focus','data-motion','data-bar-style'] });
  reduced.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  onVisualActivity(refresh);
}

export function setAmbientArtwork(url) { artwork = url || null; init(); refresh(); }
export function setAmbientWallpaper(url) { wallpaper = url || null; init(); refresh(); }
