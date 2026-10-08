// Filtros de recomendaciones por palabras, canales y duración.
// Replica Tuning de recommend.rs para las secciones de Inicio que lo omiten.
// Las palabras se comparan completas y los canales se normalizan.

/** Cuánto pesa un canal que acaba de sonar, según la variedad elegida. */
export const VARIETY_PENALTY = { low: 0.6, normal: 0.2, high: 0.05 };

/** El canal normalizado, igual que `artist_key` en Rust. */
export function artistKey(uploader) {
  let key = String(uploader ?? "").toLowerCase();
  if (key.endsWith(" - topic")) key = key.slice(0, -" - topic".length);
  key = key.replaceAll("vevo", "").replaceAll("official", "").replaceAll("oficial", "");
  return key.split(/\s+/).filter(Boolean).join(" ");
}

function isWordChar(c) {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** Si `word` está en `text` como palabra(s) entera(s). Los dos en minúsculas. */
export function containsWord(text, word) {
  if (!word) return false;
  let from = 0;
  for (;;) {
    const i = text.indexOf(word, from);
    if (i < 0) return false;
    if (!isWordChar(text[i - 1]) && !isWordChar(text[i + word.length])) return true;
    from = i + 1;
  }
}

/** Lo que manda el frontend a Rust (`Tuning`), desde la sección "discovery". */
export function tuningFrom(discovery) {
  return {
    freshnessHours: discovery.freshHours,
    artistPenalty: VARIETY_PENALTY[discovery.variety] ?? VARIETY_PENALTY.normal,
    minDurationSecs: discovery.minSeconds,
    maxDurationSecs: discovery.maxMinutes * 60,
    excludeWords: discovery.excludeWords,
    blockedChannels: discovery.blockedChannels,
    lessChannels: discovery.lessArtists ?? [],
  };
}

/**
 * Un filtro de pistas con estas preferencias.
 * @returns {(track) => boolean}
 */
export function makeFilter(discovery) {
  const words = discovery.excludeWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const channels = new Set(discovery.blockedChannels.map(artistKey).filter(Boolean));
  const min = discovery.minSeconds;
  const max = discovery.maxMinutes * 60;

  return (track) => {
    const d = track?.duration;
    if (typeof d === "number" && (d < min || d > max)) return false;

    const title = String(track?.title ?? "").toLowerCase();
    if (words.some((w) => containsWord(title, w))) return false;

    return !channels.has(artistKey(track?.uploader));
  };
}
