// Acceso al historial persistido por Rust.

const { invoke } = window.__TAURI__.core;

/**
 * Las últimas pistas escuchadas, de la más reciente a la más antigua.
 *
 * Vienen con la misma forma que un resultado de búsqueda (id, title, uploader,
 * duration, thumbnail, watch_url), así que la lista las pinta con el mismo
 * código, más un `played_at` que de momento no se usa en pantalla.
 */
export async function loadHistory() {
  try {
    return await invoke("get_history");
  } catch (error) {
    console.warn("No se pudo leer el historial:", error);
    return [];
  }
}

/**
 * Apunta una reproducción.
 *
 * Se llama cuando el audio EMPIEZA A SONAR, no cuando se resuelve la URL: el
 * prefetch también resuelve, y una canción que el usuario nunca llegó a oír no
 * tiene sitio en su historial.
 *
 * No propaga errores: fallar al escribir el historial no debe interrumpir la
 * música.
 */
export function recordPlay(track) {
  if (!track?.id) return Promise.resolve();

  return invoke("record_play", {
    id: track.id,
    title: track.title ?? null,
    uploader: track.uploader ?? null,
    duration: track.duration ?? null,
    thumbnail: track.thumbnail ?? null,
  }).catch((error) => console.warn("No se pudo guardar en el historial:", error));
}

export function clearHistory() {
  return invoke("clear_history").catch(() => {});
}
