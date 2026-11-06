/** Metadatos y preparación deduplicados por pista/calidad; nunca guarda URLs del CDN. */
export function createAudioResolver({ load, now = () => Date.now(), ttl = 10 * 60 * 1000, max = 64 }) {
  const entries = new Map();
  function resolve(id, { quality = 'high', fresh = false } = {}) {
    const key = `${id}:${quality}`;
    const hit = entries.get(key);
    if (!fresh && hit && (hit.pending || now() < hit.expires)) return hit.promise.then(track => ({ ...track, cached: true }));
    const entry = { pending: true, expires: 0 };
    entry.promise = Promise.resolve().then(() => load(id, { quality, fresh })).then(track => {
      if (track?.id !== id) throw new Error('La resolución devolvió otra canción.');
      entry.pending = false; entry.expires = now() + ttl;
      return track;
    }).catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
    entries.delete(key); entries.set(key, entry);
    if (entries.size > max) entries.delete(entries.keys().next().value);
    return entry.promise.then(track => ({ ...track, cached: false }));
  }
  return { resolve, clear: () => entries.clear() };
}
