import * as sound from './sound.js';
import { visualsActive, onVisualActivity } from './visual-activity.js';
import * as prefs from './prefs.js';
import * as now from './nowstate.js';
import { motionEnabled } from './motion.js';
import { frequencyRanges, spectrumLevels, shouldDrawSpectrum } from './spectrum.js';

/** Opcional, solo en modo escucha. No crea contexto ni fuente de audio. */
export function initVisualizer({open = sound.openSpectrum, available = sound.active} = {}) {
  const root = document.documentElement;
  if (root.dataset.platform === 'android') return;
  const canvas = document.getElementById('focus-spectrum'), button = document.getElementById('focus-visualizer-toggle');
  const status = document.getElementById('focus-spectrum-status'), context = canvas.getContext('2d');
  let tap = null, frame = null, lastDraw = -Infinity, state = now.snapshot(), ranges = [], levels = new Float32Array(32);
  function clear() { context?.clearRect(0,0,canvas.width,canvas.height); }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; tap?.close(); tap = null; lastDraw = -Infinity; clear();
  }
  function draw(time) {
    frame = null;
    if (!tap) return;
    if (time-lastDraw >= 1000/30) {
      lastDraw = time;
      const data = tap.read();
      if (data) {
        spectrumLevels(data,ranges,levels);
        const rect = canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio || 1,2);
        const width = Math.max(1,Math.round(rect.width*scale)), height = Math.max(1,Math.round(rect.height*scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        clear(); context.fillStyle = getComputedStyle(canvas).color;
        const step = width/levels.length, gap = 2*scale;
        levels.forEach((level,i) => { const h = level*(height-4*scale); context.fillRect(i*step,(height-h)/2,Math.max(1,step-gap),h); });
      }
    }
    frame = requestAnimationFrame(draw);
  }
  function refresh() {
    const enabled = prefs.get('player.focusVisualizer'), focus = root.hasAttribute('data-focus') && !root.hasAttribute('data-mini');
    const supported = Boolean(context && available());
    button.disabled = !supported; button.setAttribute('aria-pressed',String(enabled));
    button.title = supported ? 'Mostrar el espectro del audio en modo escucha' : 'Visualizador no disponible con este modo de audio';
    canvas.hidden = !enabled || !focus;
    root.toggleAttribute('data-focus-visualizer',enabled && focus);
    const visible = visualsActive() && focus && canvas.getClientRects().length > 0;
    const allowed = shouldDrawSpectrum({enabled,focus,visible,playing:state.playing,loading:state.loading,motion:motionEnabled(),available:supported});
    const text = !supported ? 'No disponible con este modo de audio.' : !enabled ? '' : !motionEnabled() ? 'Detenido por movimiento reducido.' : state.loading ? 'Esperando audio…' : !state.playing ? 'En pausa.' : '';
    if (status.textContent !== text) status.textContent = text;
    if (!allowed) { stop(); return; }
    if (!tap) {
      try { tap = open(); } catch { tap = null; }
      if (!tap) { status.textContent = 'No se pudo activar el visualizador.'; return; }
      ranges = frequencyRanges(tap.sampleRate,tap.fftSize);
      if (!ranges.length) { stop(); return; }
    }
    if (frame === null) frame = requestAnimationFrame(draw);
  }
  button.addEventListener('click',()=>prefs.set('player.focusVisualizer',!prefs.get('player.focusVisualizer')));
  prefs.on('player.focusVisualizer',refresh);
  now.onChange(value=>{state=value;refresh();});
  new MutationObserver(refresh).observe(root,{attributes:true,attributeFilter:['data-focus','data-mini','data-motion']});
  new ResizeObserver(refresh).observe(canvas);
  document.addEventListener('visibilitychange',refresh);
  onVisualActivity(refresh);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',refresh);
  window.addEventListener('pagehide',stop);
  refresh();
}
