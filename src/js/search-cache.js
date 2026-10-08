// Small session cache: repeated searches share work and do not wake the network.
export function createSearchCache(fetch, { now = Date.now, ttl = 300000, max = 30 } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async (query, limit) => {
    const clean = String(query).trim().replace(/\s+/g, " ");
    if (!clean) return [];
    const key = `${clean.toLocaleLowerCase()}|${limit ?? "default"}`;
    const hit = cache.get(key);
    if (hit && now() - hit.time < ttl) return structuredClone(hit.value);
    if (!pending.has(key)) {
      const task = Promise.resolve().then(() => fetch(clean, limit)).then(value => {
        if (value.length) {
          cache.delete(key);
          cache.set(key, { time: now(), value: structuredClone(value) });
          while (cache.size > max) cache.delete(cache.keys().next().value);
        }
        return value;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
    }
    return structuredClone(await pending.get(key));
  };
}
