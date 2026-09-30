// Metadatos y controles multimedia del sistema mediante Media Session API.

const session = "mediaSession" in navigator ? navigator.mediaSession : null;

/** Cada cuánto se le cuenta a Windows por dónde va la canción. */
const POSITION_EVERY_MS = 1000;
let lastPosition = 0;

/**
 * @param {object} actions  `{ play, pause, next, prev, seek(segundos), skip(delta) }`
 */
export function initMediaSession(actions) {
  if (!session) return;

  const handlers = {
    play: () => actions.play(),
    pause: () => actions.pause(),
    stop: () => actions.pause(),
    nexttrack: () => actions.next(),
    previoustrack: () => actions.prev(),
    seekto: (details) => actions.seek(details.seekTime),
    seekbackward: (details) => actions.skip(-(details.seekOffset ?? 10)),
    seekforward: (details) => actions.skip(details.seekOffset ?? 10),
  };

  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Acción que este WebView no conoce: se ignora.
    }
  }
}

/** Lo que suena: título, artista y carátula para el panel de Windows. */
export function setTrack(track) {
  if (!session) return;

  if (!track) {
    session.metadata = null;
    return;
  }

  // La miniatura JPEG de YouTube y no la que trae la pista, que a veces es
  // WebP: el panel de Windows no siempre la sabe pintar.
  const artwork = track.id
    ? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`
    : track.thumbnail;

  session.metadata = new MediaMetadata({
    title: track.title ?? "Antares",
    artist: track.uploader ?? "",
    album: "Antares",
    artwork: artwork ? [{ src: artwork, sizes: "480x360", type: "image/jpeg" }] : [],
  });
}

export function setPlaying(playing) {
  if (session) session.playbackState = playing ? "playing" : "paused";
}

/** Por dónde va la canción, para la barra del panel de Windows. */
export function setPosition(position, duration) {
  if (!session?.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const now = performance.now();
  if (now - lastPosition < POSITION_EVERY_MS) return;
  lastPosition = now;

  try {
    session.setPositionState({
      duration,
      position: Math.min(Math.max(position, 0), duration),
      playbackRate: 1,
    });
  } catch {
    // Datos incoherentes en mitad de un cambio de canción: la próxima vale.
  }
}
