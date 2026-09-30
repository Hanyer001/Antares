// Escucha las actualizaciones de yt-dlp realizadas por Rust.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/**
 * Avisa cuando Rust instala una versión nueva.
 *
 * El callback recibe la versión (una fecha, tipo "2025.08.11").
 */
export function onUpdated(callback) {
  // `listen` devuelve una promesa con la función para dejar de escuchar. No la
  // guardamos porque este listener vive lo que viva la ventana.
  listen("ytdlp-updated", (event) => callback(event.payload)).catch((error) =>
    console.warn("No se pudo escuchar el evento de actualización:", error),
  );
}

/**
 * Fuerza una comprobación, saltándose el límite de una al día.
 *
 * @returns {Promise<string|null>} La versión instalada, o null si ya estaba al día.
 */
export function checkNow() {
  return invoke("update_ytdlp");
}

/**
 * Versión de yt-dlp que está usando la app ahora mismo.
 *
 * Cuesta ~1 s porque arranca el binario para preguntárselo, así que el panel de
 * ajustes solo la pide una vez por sesión.
 *
 * @returns {Promise<string|null>}
 */
export async function installedVersion() {
  try {
    return await invoke("ytdlp_version");
  } catch (error) {
    console.warn("No se pudo leer la versión de yt-dlp:", error);
    return null;
  }
}
