// Acceso a escuchas, valoraciones, listas y recomendaciones de Rust.

const { invoke } = window.__TAURI__.core;

/** Id reservado de la lista "Me gusta". Tiene que coincidir con `LIKES_ID` en Rust. */
export const LIKES_ID = "likes";

/**
 * Lo que Rust necesita de una pista. Cualquier fila vale (búsqueda, historial,
 * lista): Rust ignora los campos que sobran, pero así el mensaje va limpio.
 */
function payload(track) {
  return {
    id: track.id,
    is_music: track.is_music ?? null,
    title: track.title ?? null,
    uploader: track.uploader ?? null,
    duration: track.duration ?? null,
    thumbnail: track.thumbnail ?? null,
  };
}

// --- Escuchas y valoraciones ---------------------------------------------

/**
 * Apunta cómo fue una escucha. Devuelve la clasificación ("complete", "skip"
 * o "partial"), o null si falló: fallar aquí nunca debe interrumpir la música.
 */
export function recordListen({ track, listened, ended, learn = true }) {
  if (!track?.id) return Promise.resolve(null);

  return invoke("record_listen", { track: payload(track), listened, ended, learn }).catch((error) => {
    console.warn("No se pudo guardar la escucha:", error);
    return null;
  });
}

/** @returns {Promise<"none"|"like"|"dislike">} */
export async function getRating(id) {
  if (!id) return "none";

  try {
    return await invoke("get_rating", { id });
  } catch (error) {
    console.warn("No se pudo leer la valoración:", error);
    return "none";
  }
}

/** @param {"none"|"like"|"dislike"} rating */
export function setRating(track, rating) {
  return invoke("set_rating", { track: payload(track), rating });
}

// --- Listas --------------------------------------------------------------

/** "Me gusta" primero y después las del usuario, de la más reciente a la más antigua. */
export async function getPlaylists() {
  try {
    return await invoke("get_playlists");
  } catch (error) {
    console.warn("No se pudieron leer las listas:", error);
    return [];
  }
}

/** Crea una lista y devuelve su id. */
export function createPlaylist(name, tracks = []) {
  return invoke("create_playlist", { name, tracks: tracks.map(payload) });
}

export function renamePlaylist(id, name) {
  return invoke("rename_playlist", { id, name });
}

export function deletePlaylist(id) {
  return invoke("delete_playlist", { id });
}

/** @returns {Promise<boolean>} false si la pista ya estaba en la lista. */
export function addToPlaylist(id, track) {
  return invoke("add_to_playlist", { id, track: payload(track) });
}

export function removeFromPlaylist(id, trackId) {
  return invoke("remove_from_playlist", { id, trackId });
}

export function moveInPlaylist(id, from, to) {
  return invoke("move_in_playlist", { id, from, to });
}

/** Pone la lista en el orden de `order` (ids de pista). */
export function reorderPlaylist(id, order) {
  return invoke("reorder_playlist", { id, order });
}

/**
 * Importa una lista por su enlace: YouTube, YouTube Music, Spotify, Deezer o
 * Apple Music.
 *
 * @returns {Promise<{ id: string, name: string, count: number, missing: string[] }>}
 *   `missing`: las canciones ("Artista - Canción") que no aparecieron en YouTube Music.
 */
export function importPlaylist(url) {
  return invoke("import_playlist", { url });
}

/** Importa canciones pegadas o un CSV exportado de cualquier app. Igual que arriba. */
export function importText(name, text) {
  return invoke("import_text", { name: name || null, text });
}

// --- Recomendaciones -----------------------------------------------------

/**
 * Pide recomendaciones. Cada una trae además `seed` (de qué Mix salió) y
 * `reason` (por qué está, para mostrarlo).
 *
 * @param {object} req
 * @param {"mix"|"radio"} req.mode  Aleatorio inteligente, o radio de la primera semilla.
 * @param {object[]} [req.seeds]    Canciones de partida (en radio, obligatoria).
 * @param {number} req.count
 * @param {number} req.adventure    0..1: cuánto de lo que suena es nuevo.
 * @param {string[]} [req.exclude]  Ids que no deben salir.
 * @param {string[]} [req.avoidSeeds] Semillas que el usuario va saltando.
 * @param {object} [req.tuning]     Ajustes del recomendador (ver filters.js).
 */
export function recommend({ mode, seeds = [], count, adventure, exclude = [], avoidSeeds = [], tuning }) {
  return invoke("recommend", {
    request: {
      mode,
      seeds: seeds.filter((s) => s?.id).map(payload),
      count,
      adventure,
      exclude,
      avoidSeeds,
      tuning,
    },
  });
}
