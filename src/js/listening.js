// Acumula los avances pequeños de currentTime entre eventos timeupdate.
// Los saltos grandes o hacia atrás se consideran búsquedas, no tiempo escuchado.
// main.js decide cuándo guardar el resultado.

/** Por encima de esto entre dos `timeupdate`, fue un salto y no escucha. */
const MAX_STEP_SECONDS = 1.5;

/** La escucha en curso: `{ track, listened, lastTime }`, o null. */
let session = null;

/** Empieza a contar una pista nueva. Descarta cualquier sesión sin cerrar. */
export function start(track) {
  session = { track, listened: 0, lastTime: null };
}

/** Se llama con cada `timeupdate` del `<audio>`. */
export function tick(currentTime) {
  if (!session) return;

  if (session.lastTime !== null) {
    const step = currentTime - session.lastTime;
    if (step > 0 && step < MAX_STEP_SECONDS) session.listened += step;
  }

  session.lastTime = currentTime;
}

/**
 * Cierra la escucha y la devuelve para guardarla, o null si no había ninguna.
 *
 * @param {boolean} ended Si la pista llegó al final por sí sola.
 */
export function finish(ended = false) {
  if (!session) return null;

  const { track, listened } = session;
  session = null;

  return { track, listened, ended };
}
