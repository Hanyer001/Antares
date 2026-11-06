/** Conserva el desplazamiento al ir de una lista a un artista y volver. */
export function createViewMemory(elements) {
  const saved = new Map();
  let current = null, restoring = false, lastTarget = null;
  const visible = node => node && node.getClientRects().length > 0;
  document.addEventListener('pointerdown', event => { lastTarget = event.target; restoring = false; }, true);
  document.addEventListener('wheel', () => { restoring = false; }, { passive: true });
  document.addEventListener('keydown', () => { restoring = false; }, true);
  function restore() {
    const snapshot = saved.get(current);
    if (!restoring || !snapshot) return;
    for (const [node, position] of snapshot.scrolls) if (visible(node)) node.scrollTop = position;
    if (snapshot.track) {
      const row = [...document.querySelectorAll('.result[data-id]')].find(node => node.dataset.id === snapshot.track && visible(node));
      row?.focus({ preventScroll: true });
    }
  }
  for (const node of elements.filter(Boolean)) node.addEventListener('antares:rows-ready', restore);
  return {
    prepare(key) {
      if (key === current) return;
      if (current) {
        const focused = lastTarget?.closest?.('[data-id]') || document.activeElement?.closest?.('[data-id]');
        saved.set(current, { scrolls: elements.filter(visible).map(node => [node, node.scrollTop]), track: focused?.dataset.id });
        if (saved.size > 40) saved.delete(saved.keys().next().value);
      }
      lastTarget = null;
      current = key;
      restoring = saved.has(key);
    },
    restore,
  };
}
