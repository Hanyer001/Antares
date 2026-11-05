// WebKitGTK necesita HTTP para medios; WebView2 conserva el protocolo stream.
export function playbackSource(url, proxyBase, convertFileSrc) {
  if (proxyBase) return `${proxyBase}/${encodeURIComponent(url)}`;
  return convertFileSrc(url, "stream");
}
