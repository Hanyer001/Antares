// Caché de Inicio: conserva las tarjetas al navegar, hasta que cambia el gusto.
// Una petición de una generación anterior nunca puede reponer datos descartados.
export function createShelfCache() {
  const entries = new Map();
  let dirty = false;
  return {
    entries,
    invalidate() { dirty = true; },
    get needsRefresh() { return dirty; },
    consumeInvalidation() { const changed = dirty; dirty = false; return changed; },
    async generate(key, make, changed = () => {}) {
      const pending = { state: 'loading' };
      entries.set(key, pending);
      changed();
      try {
        const shelf = await make();
        if (entries.get(key) !== pending) return;
        entries.set(key, shelf ? { ...shelf, state: 'ready' } : { state: 'empty' });
        changed();
      } catch (error) {
        if (entries.get(key) !== pending) return;
        entries.set(key, { state: 'error' });
        changed();
        throw error;
      }
    },
  };
}
