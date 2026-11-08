// Agrupa los resultados por el artista identificado en YouTube Music.
// Prioriza la canción del artista y luego otras versiones de la misma pista.

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

/** Título y artista de una pista, para ver si dos filas se verían iguales. */
function lookKey(track) {
  return `${words(track.title).join(" ")}|${artistKey(track.uploader)}`;
}

function songQueryForArtist(query, artist) {
  const wanted = words(query);
  const key = artistKey(artist);
  if (!key) return null;
  for (let i = 1; i < wanted.length; i++) {
    if (artistKey(wanted.slice(0, i).join(" ")) === key) return wanted.slice(i).join(" ");
    if (artistKey(wanted.slice(i).join(" ")) === key) return wanted.slice(0, i).join(" ");
  }
  return null;
}

function videoFromArtist(track, query) {
  const key = artistKey(track.uploader);
  if (!key) return false;
  const title = track.title ?? "";
  const parts = title.split(/\s[-–—]\s/);
  const names = parts.length > 1 ? parts.flatMap((part) => part.split(",")) : [];
  const channelInTitle = names.some((name) => artistKey(name.trim()) === key);
  const songQuery = songQueryForArtist(query, track.uploader);
  // En una búsqueda que nombra al artista, su canal es una señal más fuerte
  // que la etiqueta "oficial" escrita por alguien en un título.
  if (songQuery) return matchesQuery(title, songQuery);
  return (channelInTitle || /(?:\s-\sTopic|VEVO)$/i.test(track.uploader))
    && matchesQuery(title, query);
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
    const titleMatches = matchesQuery(s.title, query) || s.artists?.some((artist) => {
      const title = songQueryForArtist(query, artist.name);
      return title && matchesQuery(s.title, title);
    });
    if (!titleMatches || officialLooks.has(lookKey(s))) return false;
    officialLooks.add(lookKey(s));
    return true;
  });
  const namedSong = official.find((song) => song.artists?.some((artist) => {
    const title = songQueryForArtist(query, artist.name);
    return title && matchesQuery(song.title, title);
  }));
  const namedVideo = all.find((track) =>
    songQueryForArtist(query, track.uploader) && videoFromArtist(track, query));
  const main = namedSong ?? (namedVideo ? null : official.find((song) => song.artists?.length));
  if (!main) {
    const first = namedVideo ?? all.find((track) => videoFromArtist(track, query));
    if (!first) return { tracks: all, artist: null, split: -1 };
    const key = artistKey(first.uploader);
    const own = all.filter((track) => artistKey(track.uploader) === key && videoFromArtist(track, query));
    const versions = all.filter((track) => !own.includes(track));
    const title = songQueryForArtist(query, first.uploader) ?? query;
    return {
      tracks: [...own, ...bySongTitle(versions, title)],
      artist: first.uploader,
      split: versions.length ? own.length : -1,
    };
  }

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

  const title = main.artists.map((artist) => songQueryForArtist(query, artist.name))
    .find(Boolean) ?? query;
  const mine = take([
    ...official.filter(isMine),
    ...all.filter((track) => keys.includes(artistKey(track.uploader)) && matchesQuery(track.title, title)),
  ]);
  const others = take(bySongTitle([...all, ...official.filter((s) => !isMine(s))], title));

  return {
    tracks: [...mine, ...others],
    artist: main.uploader ?? main.artists.map((a) => a.name).join(", "),
    split: others.length > 0 ? mine.length : -1,
  };
}

function bySongTitle(tracks, title) {
  return [...tracks].sort((a, b) =>
    Number(matchesQuery(b.title, title)) - Number(matchesQuery(a.title, title)));
}
