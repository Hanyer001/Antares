import { artistKey, words } from './songmatch.js';
const look = track => track?.title && track?.uploader ? `${words(track.title).join(' ')}|${artistKey(track.uploader)}` : null;

/** Mantiene el orden y la identidad de lo que ya se mostró. La segunda fuente
 * solo añade canciones, nunca mueve una fila que el usuario va a pulsar. */
export function appendUniqueTracks(current, incoming) {
  const seen = new Set(current.map(track => track.id));
  const looks = new Set(current.map(look).filter(Boolean));
  return [...current, ...incoming.filter(track => {
    const key = look(track);
    if (!track?.id || seen.has(track.id) || (key && looks.has(key))) return false;
    seen.add(track.id); if (key) looks.add(key); return true;
  })];
}

/** Publica cada fuente en cuanto responde; un fallo no oculta la otra. */
export async function progressiveSearch(sources, onUpdate) {
  let tracks = [];
  const errors = [];
  await Promise.all(sources.map(source => Promise.resolve(source).then(incoming => {
    const next = appendUniqueTracks(tracks, incoming ?? []);
    if (next.length === tracks.length) return;
    tracks = next;
    onUpdate(tracks);
  }, error => errors.push(error))));
  if (!tracks.length && errors.length === sources.length) throw errors[0];
  return tracks;
}
