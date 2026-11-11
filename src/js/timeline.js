export const clampRatio = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
export function mediaDuration(measured, expected, checkCatalog = false) {
  const known = Number.isFinite(expected) && expected > 0;
  if (checkCatalog && known && (!Number.isFinite(measured) || measured <= 0 || Math.abs(measured - expected) > Math.max(5, expected * .25))) return expected;
  return Number.isFinite(measured) && measured > 0 ? measured : known ? expected : null;
}
// Algunos MP4 fragmentados siguen avanzando sin emitir ended en Safari.
export function passedCatalogEnd(current, measured, expected) {
  return Number.isFinite(expected) && expected > 0
    && (!Number.isFinite(measured) || measured <= 0 || measured - expected > Math.max(5, expected * .25))
    && current >= expected + 1;
}
export function timeline(current, duration) {
  const known = Number.isFinite(duration) && duration > 0;
  const ratio = known ? clampRatio(current / duration) : 0;
  return { duration: known ? duration : null, current: known ? ratio * duration : 0, ratio };
}
export function keyboardSeek(key, current, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const deltas = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -10, PageUp: 10 };
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  return key in deltas ? clampRatio((current + deltas[key]) / duration) : null;
}
