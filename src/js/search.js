// Acceso a los comandos de búsqueda y resolución de audio de Rust.

import { createSearchCache } from "./search-cache.js";
const { invoke } = window.__TAURI__.core;
const cachedSearch = createSearchCache((query, limit) => invoke("search_tracks", { query, limit }));

/**
 * Resuelve la URL de audio.
 *
 * Tauri convierte el camelCase de JS al snake_case de Rust, así que `safeMode`
 * llega como `safe_mode`. Devuelve la pista con sus metadatos y cómo se
 * consiguió: `{ url, title, uploader, duration, thumbnail, id, cached, safe }`.
 *
 * También sirve para saber qué hay detrás de un enlace pegado sin
 * reproducirlo: de paso deja la URL en caché, y darle a play después es
 * instantáneo.
 */
export function resolveTrack(query, safeMode = false, fresh = false) {
  return invoke("get_audio_url", { query, safeMode, fresh });
}

/**
 * Lista de candidatos para una búsqueda, sin resolver ninguna URL de audio.
 * Con un enlace pegado Rust devuelve lista vacía: eso lo resuelve `resolveTrack`.
 */
export function searchTracks(query, limit) {
  return cachedSearch(query, limit);
}

/** Cuánto se espera a YouTube Music antes de enseñar la búsqueda sin él. */
const SONGS_TIMEOUT_MS = 4000;

/**
 * Canciones oficiales de YouTube Music para lo buscado, cada una con sus
 * `artists`. Nunca falla ni hace esperar de más: sin ellas (sin conexión con
 * YouTube Music, o si tarda), la búsqueda sale igual, sin ordenar por artista.
 */
export function searchSongs(query) {
  const songs = invoke("search_songs", { query }).catch(() => []);
  const late = new Promise((resolve) => setTimeout(() => resolve([]), SONGS_TIMEOUT_MS));
  return Promise.race([songs, late]);
}

/**
 * Resuelve por adelantado una pista concreta (al pasar el ratón por su fila, o
 * la siguiente de la cola). Rust deduplica: si ya está resuelta o en curso, no
 * hace nada.
 */
export function prefetchTrack(watchUrl) {
  if (!watchUrl) return Promise.resolve();
  return invoke("prefetch_audio_url", { query: watchUrl }).catch(() => {});
}
