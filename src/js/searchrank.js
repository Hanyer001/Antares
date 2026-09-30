// Agrupa los resultados por el artista identificado en YouTube Music.
// Prioriza la canción oficial y los vídeos de ese artista; el resto mantiene
// el orden recibido de YouTube.

import { artistKey, words } from "./songmatch.js";

/**
 * Si un título responde a lo buscado: tiene todas las palabras buscadas, o lo
 * buscado tiene todas las del título ("radiohead creep" → "Creep").
 */
export function matchesQuery(title, query) {
  const wanted = words(query).filter((w) => w.length >= 2);
  const have = words(title).filter((w) => w.length >= 2);
  if (wanted.length === 0 || have.length === 0) return false;

  const haveSet = new Set(have);
  if (wanted.every((w) => haveSet.has(w))) return true;
  const wantedSet = new Set(wanted);
  return have.every((w) => wantedSet.has(w));
}

/** Dos nombres de artista (ya como `artistKey`) son el mismo, o uno contiene al otro. */
function sameName(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.includes(short);
}

/**
 * Cuánto es del artista un vídeo: 2 si es de su canal, 1 si es una canción
 * suya subida por otro (el artista delante o detrás del guion: "Anuel AA -
 * …" o "… - Anuel | Letra"), 0 si no es suyo.
 */
function ownership(track, keys) {
  const channel = artistKey(track.uploader);
  if (keys.some((k) => sameName(k, channel))) return 2;

  const parts = (track.title ?? "").split(/\s[-–—]\s/);
  if (parts.length < 2) return 0;
  // Cada trozo sin lo que va tras "|", "//" o un paréntesis.
  const names = parts.map((p) => artistKey(p.split(/\||\/\/|[([]/)[0]));
  return names.some((n) => keys.some((k) => sameName(k, n))) ? 1 : 0;
}

/** Título y artista de una pista, para ver si dos filas se verían iguales. */
function lookKey(track) {
  return `${words(track.title).join(" ")}|${artistKey(track.uploader)}`;
}

/**
 * Reparte y ordena los resultados.
 *
 * @param {Array} videos  Lo que da la búsqueda de YouTube, en su orden.
 * @param {Array} songs   Canciones oficiales de YouTube Music, cada una con
 *                        `artists: [{ id, name }]`.
 * @param {string} query
 * @returns {{ tracks: Array, artist: string|null, split: number }} `split`:
 *          dónde empiezan "Otros resultados" (-1 si no hay reparto).
 */
export function rankSearch(videos, songs, query) {
  const all = videos ?? [];
  // La misma canción oficial puede estar en dos álbumes (el original y un
  // recopilatorio): con el mismo título y artista, sale una vez.
  const officialLooks = new Set();
  const official = (songs ?? []).filter((s) => {
    if (!matchesQuery(s.title, query) || officialLooks.has(lookKey(s))) return false;
    officialLooks.add(lookKey(s));
    return true;
  });
  const main = official.find((s) => s.artists?.length);
  if (!main) return { tracks: all, artist: null, split: -1 };

  const keys = main.artists.map((a) => artistKey(a.name)).filter(Boolean);
  const isMine = (song) => song.artists?.some((a) => keys.includes(artistKey(a.name)));

  // Sin repetir vídeo, ni una fila que se vería igual que la canción oficial
  // (mismo título y mismo artista: otra subida de lo mismo).
  const seen = new Set();
  const looks = new Set(official.map(lookKey));
  const take = (list) =>
    list.filter((t) => {
      if (!t?.id || seen.has(t.id)) return false;
      if (!official.includes(t) && looks.has(lookKey(t))) return false;
      seen.add(t.id);
      return true;
    });

  const scored = all.map((track) => ({ track, score: ownership(track, keys) }));
  const mine = take([
    ...official.filter(isMine),
    ...scored.filter((s) => s.score === 2).map((s) => s.track),
    ...scored.filter((s) => s.score === 1).map((s) => s.track),
  ]);
  const others = take([...scored.filter((s) => s.score === 0).map((s) => s.track), ...official.filter((s) => !isMine(s))]);

  return {
    tracks: [...mine, ...others],
    artist: main.uploader ?? main.artists.map((a) => a.name).join(", "),
    split: others.length > 0 ? mine.length : -1,
  };
}
