// Formato de tiempos, origen del audio y mensajes de error.

/**
 * Segundos a `m:ss`, o `h:mm:ss` si pasa de la hora.
 * Devuelve `--:--` mientras no se conoce la duración.
 */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  const pad = (n) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * De dónde salió la URL de audio, para la consola de desarrollo: así se
 * comprueba si la caché y el cliente rápido funcionan. Nunca va a la interfaz.
 */
export function describeOrigin({ cached, safe }) {
  if (cached) return "caché";
  return safe ? "yt-dlp/seguro" : "yt-dlp/rápido";
}

/** Casos conocidos, con lo que se le dice al usuario. */
const KNOWN_ERRORS = [
  [/private|privad|unavailable|removed|no longer available|copyright|terminated/i,
    "Esa canción no está disponible en YouTube."],
  [/sign in to confirm your age|age[- ]restricted|inappropriate/i,
    "YouTube pide iniciar sesión para escuchar esa canción."],
  [/timed? ?out|resolve host|getaddrinfo|network|connection refused|connection reset|unable to download|failed to fetch|dns/i,
    "No hay conexión con YouTube. Comprueba tu internet e inténtalo de nuevo."],
];

/**
 * Lo que dice un mensaje de error que no es para el usuario: nombres de
 * programas, trazas, códigos del sistema. Los mensajes que Rust escribe para
 * la interfaz ("Ponle un nombre a la lista.") no llevan nada de esto.
 */
const TECHNICAL = /yt-dlp|ytdlp|\bERROR\b|HTTP|os error|fallo interno|sidecar|pyinstaller|stderr|traceback|panicked|bloquead|\binvoke\b|TypeError|ReferenceError|NotAllowedError|NotSupportedError|AbortError|\.rs:|\.js:\d|0x[0-9a-f]+/i;

/**
 * Un error, dicho para una persona: los conocidos con su explicación, los
 * técnicos con `fallback`, y los que ya están escritos para el usuario, tal
 * cual. El detalle técnico va a la consola de desarrollo, no a la pantalla.
 *
 * @param {unknown} error
 * @param {string} [fallback]
 */
export function friendlyError(error, fallback = "Algo no salió bien. Inténtalo de nuevo.") {
  const text = (typeof error === "string" ? error : error?.message ?? String(error ?? "")).trim();

  for (const [pattern, message] of KNOWN_ERRORS) {
    if (pattern.test(text)) return message;
  }

  // Los errores del propio motor (TypeError, DOMException...) son fallos del
  // programa; los `Error` a secas son los que la app lanza con un mensaje
  // pensado para el usuario ("Ponle un nombre al perfil.").
  const engineError = typeof error === "object" && error !== null && error.name && error.name !== "Error";

  if (!text || engineError || TECHNICAL.test(text) || text.length > 160) {
    if (text) console.warn("Error:", text);
    return fallback;
  }
  return text;
}
