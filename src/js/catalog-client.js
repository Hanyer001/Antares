const TTL = 30 * 60 * 1000;
const MAX_ENTRIES = 64;

/** Mantiene el contrato del catálogo compartido entre Tauri y la PWA. */
export function createCatalogClient(invoke) {
  const cache = new Map();

  function cached(command, args) {
    const key = JSON.stringify([command, args]);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < TTL) return hit.promise;

    const entry = { time: Date.now(), promise: Promise.resolve().then(() => invoke(command, args)) };
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return entry.promise;
  }

  return {
    fetchArtist: id => cached("artist_page", { id }),
    fetchArtistSongs: id => cached("artist_songs", { id }),
    fetchAlbum: id => cached("album_page", { id }),
    fetchList: id => cached("youtube_list", { id }),
    fetchMore: (browseId, params) => cached("shelf_more", { browseId, params: params ?? null }),
    trackLinks: track => cached("track_links", {
      videoId: track.id ?? null,
      uploader: track.uploader ?? null,
      title: track.title ?? null,
    }),
    artistForQuery: query => cached("artist_for_query", { query }).catch(() => null),
    searchSongs: query => cached("search_songs", { query }),
  };
}
