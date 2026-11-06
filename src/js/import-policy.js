// Clasificación compartida; no carga controles ni vistas.
/**
 * Qué se pegó: un enlace (una sola línea que lo parece) o canciones.
 *
 * @returns {{ url: string } | { text: string } | null}
 */
export function classify(raw) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const single = !/[\r\n]/.test(text);
  if (single && /^(https?:\/\/|spotify:)\S+$/i.test(text)) return { url: text };
  // Los enlaces copiados sin protocolo siguen siendo enlaces, no canciones.
  if (single && !/\s/.test(text) && serviceName(text)) return { url: `https://${text}` };
  return { text };
}

/** Si el texto pegado es de un servicio que se lee por enlace. */
export function serviceName(url) {
  const text = String(url ?? "").trim();
  if (/^spotify:/i.test(text)) return "Spotify";
  let u;
  try { u = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`); }
  catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (["open.spotify.com", "spotify.com", "www.spotify.com", "spotify.link", "spoti.fi"].includes(host)) return "Spotify";
  if (["deezer.com", "www.deezer.com", "link.deezer.com", "deezer.page.link"].includes(host)) return "Deezer";
  if (["music.apple.com", "embed.music.apple.com"].includes(host)) return "Apple Music";
  if (host === "music.youtube.com") return "YouTube Music";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "YouTube";
  return null;
}

/** Un enlace de colección se importa; no se intenta resolver como audio. */
export function isPlaylistLink(raw) {
  const input = classify(raw);
  if (!input?.url) return false;
  const service = serviceName(input.url);
  if (!service) return false;
  if (/^spotify:/i.test(input.url)) return /^spotify:(?:user:[^:]+:)?(?:playlist|album):[^:]+$/i.test(input.url);
  const url = new URL(input.url);
  if (service.startsWith("YouTube")) return Boolean(url.searchParams.get("list"));
  if (service === "Spotify" && ["spotify.link", "spoti.fi"].includes(url.hostname)) return true;
  if (service === "Deezer" && ["link.deezer.com", "deezer.page.link"].includes(url.hostname)) return true;
  return /\/(playlist|album)\/[^/]+/i.test(url.pathname);
}

/** Contar por separado las entradas leídas, las ausentes y las repetidas. */
export function importSummary(result) {
  const missing = result.missing?.length ?? 0;
  const duplicates = result.duplicates ?? 0;
  const total = result.source_count ?? result.count + missing + duplicates;
  return `Importada «${result.name}» · ${result.count} de ${total} canciones`
    + (missing ? ` · ${missing} sin encontrar` : "")
    + (duplicates ? ` · ${duplicates} repetidas` : "");
}

