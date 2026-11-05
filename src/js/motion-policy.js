export function motionTiming(mode, systemReduced = false) {
  const enabled = !systemReduced && mode !== 'reduced' && mode !== 'none';
  return { feedback: enabled ? 140 : 0, navigation: enabled ? 200 : 0, panel: enabled ? 260 : 0 };
}
export function lyricScrollBehavior(mode, systemReduced, distance, viewport) {
  return motionTiming(mode, systemReduced).navigation && Math.abs(distance) < viewport ? 'smooth' : 'auto';
}
