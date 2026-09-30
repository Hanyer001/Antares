// Calcula el orden de una lista. main.js lo guarda y gestiona Deshacer.

/** `label`: en el menú. `done`: en el aviso, tras "Lista ordenada…". */
export const SORTS = [
  { id: "title", label: "Título (A–Z)", done: "por título" },
  { id: "artist", label: "Artista (A–Z)", done: "por artista" },
  { id: "duration", label: "Duración (más cortas primero)", done: "por duración" },
  { id: "reverse", label: "Invertir el orden", done: "al revés" },
];

/** Compara como una persona: sin mirar tildes ni mayúsculas, y "2" antes que "10". */
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

const artistOf = (track) => (track.uploader ?? "").replace(/ - Topic$/, "").trim();
const titleOf = (track) => (track.title ?? "").trim();

/** Compara textos dejando los vacíos al final. */
function byText(a, b) {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return collator.compare(a, b);
}

const COMPARE = {
  title: (a, b) => byText(titleOf(a), titleOf(b)),
  artist: (a, b) => byText(artistOf(a), artistOf(b)) || byText(titleOf(a), titleOf(b)),
  duration: (a, b) => {
    const da = a.duration ?? null;
    const db = b.duration ?? null;
    // Sin duración (un directo, una pista vieja sin dato) van al final.
    if (da === null || db === null) return (da === null ? 1 : 0) - (db === null ? 1 : 0);
    return da - db;
  },
};

/**
 * Las pistas en el orden pedido, en una copia. El orden de las que empatan no
 * cambia (el sort de JS es estable).
 *
 * @param {Array} tracks
 * @param {"title"|"artist"|"duration"|"reverse"} by
 */
export function sortTracks(tracks, by) {
  const copy = [...tracks];
  if (by === "reverse") return copy.reverse();

  const compare = COMPARE[by];
  return compare ? copy.sort(compare) : copy;
}

/** "Lista ordenada por título." */
export function sortDoneText(by) {
  const done = SORTS.find((s) => s.id === by)?.done;
  return done ? `Lista ordenada ${done}.` : "Lista ordenada.";
}
