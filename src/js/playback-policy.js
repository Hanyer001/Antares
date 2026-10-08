// Una selección conocida siempre se resuelve por ID, también al reintentar.
export function playbackQuery(query, hint) {
  return /^[A-Za-z0-9_-]{11}$/.test(hint?.id ?? "")
    ? `https://www.youtube.com/watch?v=${hint.id}` : query;
}
export function assertSelectedTrack(result, hint) {
  if (hint?.id && result.id !== hint.id) {
    throw new Error("La respuesta no corresponde a la canción elegida. Inténtalo de nuevo.");
  }
}
