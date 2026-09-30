// Compara canciones tras normalizar título y artista. Ignora etiquetas
// editoriales como "Official Video", pero distingue directos, remixes y
// versiones acústicas de la grabación de estudio.

/** Minúsculas y sin tildes: "Tití" y "titi" son lo mismo. */
function fold(text) {
  return (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lo que hace que sea otra versión de la canción. */
const VERSION_RE =
  /\b(remix|live|en vivo|en directo|acoustic|acustic[oa]|unplugged|cover|instrumental|karaoke|slowed|sped up|speed up|reverb|nightcore|8d|demo|a ?capella)\b/g;

/** Palabras de relleno que se añaden a los títulos y no son la canción. */
const NOISE = new Set([
  "official", "oficial", "video", "videoclip", "clip", "audio", "lyric", "lyrics", "letra", "letras",
  "visualizer", "hd", "hq", "4k", "1080p", "720p", "60fps", "full", "mv", "remaster", "remastered",
  "remasterizado", "remasterizada", "remasterizacion", "digitally", "digital", "deluxe", "edition",
  "edicion", "explicit", "clean", "mono", "subtitulado", "subtitulada", "sub", "subs",
]);

/** Lo que une nombres de artistas y no es su nombre: "Simon & Garfunkel". */
const JOINERS = new Set(["and", "y", "e", "x", "feat", "ft", "featuring", "con", "with", "the"]);

export function words(text) {
  return fold(text)
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Qué versión es: "" para la de siempre, o "en vivo", "remix"... */
function versionOf(title) {
  const found = fold(title).match(VERSION_RE) ?? [];
  return [...new Set(found.map((v) => v.replace(/\s+/g, " ")))].sort().join(",");
}

/**
 * El título sin añadidos: sin lo que va entre paréntesis o corchetes, sin lo
 * que va tras " // " o " | ", y sin "ft. Alguien".
 */
function stripExtras(title) {
  return fold(title)
    .replace(/\s(\/\/|\||·)\s.*$/, "")
    .replace(/[([{【].*?[)\]}】]/g, " ")
    .replace(/\s(ft|feat|featuring)\.?\s.*$/, "");
}

/** Lo que queda de un trozo de título: sus palabras sin relleno, años ni versión. */
function core(text) {
  return words(text.replace(VERSION_RE, " "))
    .filter((w) => !NOISE.has(w) && !/^(19|20)\d\d$/.test(w))
    .join(" ");
}

/** "Radiohead - Topic", "TaylorSwiftVEVO", "Queen Official" → el nombre, junto. */
export function artistKey(name) {
  const cleaned = fold(name)
    .replace(/\s-\stopic$/, "")
    .replace(/vevo$/, "")
    .replace(/\s(official|oficial)$/, "");
  return words(cleaned)
    .filter((w) => !JOINERS.has(w))
    .join("");
}

/**
 * Las lecturas posibles de una pista: `{ artist, title }`. Con "A - B" en el
 * título no se sabe cuál es el artista, así que valen las dos; y además el
 * canal como artista y el título entero como canción.
 */
function readings(track) {
  const parts = stripExtras(track.title)
    .split(/\s[-–—~]\s/)
    .map(core)
    .filter(Boolean);
  const compact = (s) => s.replace(/\s/g, "");
  const out = [];

  if (parts.length >= 2) {
    out.push({ artist: compact(parts[0]), title: compact(parts[1]) });
    out.push({ artist: compact(parts[1]), title: compact(parts[0]) });
  }
  if (parts.length >= 1) {
    out.push({ artist: artistKey(track.uploader), title: compact(parts.join(" ")) });
  }
  return out;
}

/**
 * Dos artistas son el mismo si coinciden, si falta uno, o si uno contiene al
 * otro ("badbunny" y "badbunnyjhaycortez").
 */
function sameArtist(a, b) {
  if (!a || !b || a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.includes(short);
}

/** Si `a` y `b` son la misma canción, aunque sean vídeos distintos. */
export function sameSong(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  if (versionOf(a.title) !== versionOf(b.title)) return false;

  const ra = readings(a);
  const rb = readings(b);
  return ra.some((x) =>
    rb.some((y) => x.title.length >= 2 && x.title === y.title && sameArtist(x.artist, y.artist)),
  );
}

/** La primera de `tracks` que es la misma canción que `track`, o null. */
export function findSame(tracks, track) {
  return (tracks ?? []).find((t) => sameSong(t, track)) ?? null;
}

/**
 * Las repetidas de una lista: cada una con la que ya estaba antes que ella.
 * La primera aparición se queda; las demás son las que sobran.
 *
 * @returns {Array<{ track: object, original: object }>}
 */
export function findDuplicates(tracks) {
  const kept = [];
  const dups = [];

  for (const track of tracks ?? []) {
    const original = findSame(kept, track);
    if (original) dups.push({ track, original });
    else kept.push(track);
  }
  return dups;
}
