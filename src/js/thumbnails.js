/** Miniaturas públicas de YouTube: no decodificar 1280 px para una fila de 44.
 * Se conserva el original cuando la pantalla pide más resolución o el origen
 * es otro (portadas propias, artistas y YouTube Music incluidos). */
export function displayThumbnail(source, size = 160, scale = globalThis.devicePixelRatio || 1) {
  if (!source || size * scale > 180) return source;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !/^(?:i|i\d)\.ytimg\.com$/.test(url.hostname)) return source;
    const match = /^\/(vi|vi_webp)\/([\w-]{11})\/[\w-]+\.(?:jpg|webp)$/.exec(url.pathname);
    if (!match) return source;
    return `https://i.ytimg.com/${match[1]}/${match[2]}/mqdefault.${match[1] === 'vi_webp' ? 'webp' : 'jpg'}`;
  } catch { return source; }
}
